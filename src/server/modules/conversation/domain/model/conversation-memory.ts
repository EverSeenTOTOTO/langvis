import type { LlmMessage, Message, MessageKind } from '@/shared/types/entities';
import { Role } from '@/shared/entities/Message';
import { estimateTokens } from '@/server/utils/estimateTokens';
import type { ContextUsage } from '@/server/utils/estimateTokens';
import { findLatestCompactionSummary } from './compaction-summary';
import type { HistoryCompactionConfig } from '../../application/service/history-config.fragment';
import type { LlmPort } from '@/server/libs/ports/llm/llm.port';
import { Summarizer } from '@/server/libs/compaction';
import { winstonLogger } from '@/server/utils/logger';

/** 会话记忆激活配置（激活时灌入，ConversationSession 持有）。 */
export interface ConversationMemoryConfig {
  contextSize: number;
  modelId: string;
  runtimeConfig: Record<string, unknown>;
}

/** 历史压缩（fold）产物：新 C 载荷 + 压缩后用量。conv 落盘 C 后 append 回 ConversationMemory。 */
export interface ConversationCompactionResult {
  content: string;
  startRef: string;
  usage: ContextUsage;
}

/**
 * ConversationMemory —— 会话的持久消息模型（ConversationSession 的成员实体）。
 *
 * 持有整个会话的消息（群聊即所有参与人的消息），由 ConversationSession 在会话激活时播种；
 * turn 追加消息时增量 append。提供「有效历史」视图与用量：
 *  - 有效历史 = [最新压缩摘要 C, 其后 turn]（无 C 时为全部）；每条 assistant 消息前置其
 *    meta.processSummary（loop-exit 折叠产物，用户不可见、LLM 可见）。不做硬截断。
 *  - 用量与 buildContext 同口径（都是有效历史）。
 *
 * 自维护历史压缩（compact）：有效历史用量超阈时把「上一个 C + tail」滚动折叠成新 C，返回载荷
 * （不含持久化——落盘 compact 消息是 CompleteTurnHandler 的职责，避免反向依赖 message repo）。
 * fold 原语来自 libs/compaction（与 agent 的 WorkingMemory 同机制）。对应 agent 的
 * WorkingMemory——两者皆自持压缩、瞬态、纯数据 + 一个 fold 方法。压缩配置直取
 * runtimeConfig.history（HistoryCompactionConfig，上游 resolveConversationConfig 已 parse 回填默认），
 * llm 由 handler 按调用传入（构造期保持纯、无需把 LLM_PORT 贯穿会话层）。
 */
export class ConversationMemory {
  protected readonly history: Message[];
  protected readonly contextSize: number;
  protected readonly modelId: string;
  protected readonly compaction: HistoryCompactionConfig;
  private readonly logger = winstonLogger.child({
    source: 'ConversationMemory',
  });

  constructor(params: {
    history: Message[];
    contextSize: number;
    modelId: string;
    runtimeConfig: Record<string, unknown>;
  }) {
    this.history = [...params.history];
    this.contextSize = params.contextSize;
    this.modelId = params.modelId;
    this.compaction = (
      params.runtimeConfig as { history: HistoryCompactionConfig }
    ).history;
  }

  /** 增量追加一条消息（turn 的 user/assistant/compact 落盘后由 conv 经会话成员调用）。 */
  append(message: Message): void {
    this.history.push(message);
  }

  /** 原始消息（调试 / 投影用）。 */
  getMessages(): Message[] {
    return this.history;
  }

  async buildContext(): Promise<LlmMessage[]> {
    const messages: LlmMessage[] = [];

    // 脚手架：system + 会话上下文（meta.kind === 'context'），始终发出。
    for (const msg of this.history) {
      if (msg.role === Role.SYSTEM) {
        messages.push({ role: 'system', content: msg.content });
      } else if (
        msg.role === Role.USER &&
        (msg.meta?.kind as MessageKind | undefined) === 'context'
      ) {
        messages.push({ role: 'user', content: msg.content });
      }
    }

    // 最新压缩摘要 C（若有）作为有效历史前缀，替代被它总结的早期 turn。
    const { summary, tail } = this.getEffectiveTurns();
    if (summary) {
      messages.push({ role: 'user', content: summary.content });
    }

    // C 之后的 turn（无 C 时为全部 turn）。
    for (const turn of this.groupIntoTurns(tail)) {
      for (const msg of turn) {
        let content = msg.content;

        if (msg.role === Role.ASSIST) {
          const processSummary = msg.meta?.processSummary;
          if (typeof processSummary === 'string' && processSummary) {
            content = `${processSummary}\n\n${content}`;
          }
        }

        messages.push({ role: msg.role as LlmMessage['role'], content });
      }
    }

    return messages;
  }

  getContextUsage(): ContextUsage {
    const { summary, tail } = this.getEffectiveTurns();
    const effective = summary ? [summary, ...tail] : tail;
    return {
      used: estimateTokens(effective as unknown as LlmMessage[], this.modelId),
      total: this.contextSize,
    };
  }

  /**
   * 历史层压缩（fold）：有效历史用量超阈时把「上一个摘要 C + tail」滚动折叠成新 C，返回载荷。
   * 不含持久化（compact 消息落盘是 CompleteTurnHandler 的职责）。未配 modelId / tail 为空 /
   * 未超阈 / fold 返回空时返回 null。对应 agent 的 WorkingMemory.compact。
   */
  async compact(params: {
    llm: LlmPort;
    signal: AbortSignal;
  }): Promise<ConversationCompactionResult | null> {
    if (!this.modelId) return null;

    const { summary, index } = findLatestCompactionSummary(this.history);
    const tail = summary ? this.history.slice(index + 1) : this.history;
    if (tail.length === 0) return null;

    const effective = summary ? [summary, ...tail] : tail;
    const used = estimateTokens(toLlmMessages(effective), this.modelId);
    if (used <= this.contextSize * this.compaction.threshold) return null;

    this.logger.info(
      `History over threshold (${used}/${this.contextSize}, ${(this.compaction.threshold * 100).toFixed(0)}%) — compacting ${tail.length} messages`,
    );

    const summarizer = new Summarizer(
      params.llm,
      this.logger,
      this.compaction.windowSize,
      this.modelId,
    );
    const content = await summarizer.fold(
      summary?.content ?? null,
      toLlmMessages(tail),
      params.signal,
    );

    if (!content) return null;

    // 压缩后有效历史 = [新 C]；其用量即会话层用量，供 handler 直接回报。
    return {
      content,
      startRef: summary?.id ?? this.history[0]?.id ?? '',
      usage: {
        used: estimateTokens([{ role: 'user', content }], this.modelId),
        total: this.contextSize,
      },
    };
  }

  /**
   * 有效历史 = 最新压缩摘要 C + 其后的 turn（无 C 时为全部消息）。
   * 被 buildContext 与 getContextUsage 共用，保证"用量"与"实际发给 LLM 的内容"口径一致。
   */
  protected getEffectiveTurns(): { summary: Message | null; tail: Message[] } {
    const { summary, index } = findLatestCompactionSummary(this.history);
    const tail = summary ? this.history.slice(index + 1) : this.history;
    return { summary, tail };
  }

  protected groupIntoTurns(messages: Message[]): Message[][] {
    const turns: Message[][] = [];
    let current: Message[] = [];

    for (const msg of messages) {
      if (msg.role === Role.SYSTEM) continue;
      // 任何带 meta.kind 的都是脚手架（context/compact），非对话 turn。
      if (msg.meta?.kind) continue;

      current.push(msg);

      if (msg.role === Role.ASSIST) {
        turns.push(current);
        current = [];
      }
    }

    if (current.length > 0) {
      turns.push(current);
    }

    return turns;
  }
}

function toLlmMessages(messages: Message[]): LlmMessage[] {
  return messages.map(m => ({ role: m.role, content: m.content }));
}
