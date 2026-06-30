import type { LlmMessage, Message, MessageKind } from '@/shared/types/entities';
import { Role } from '@/shared/entities/Message';
import { estimateTokens } from '@/server/utils/estimateTokens';
import type { ContextUsage } from '@/server/utils/estimateTokens';
import { findLatestCompactionSummary } from './compaction-summary';

/** 会话记忆激活配置（激活时灌入，ConversationSession 持有以驱动历史压缩）。 */
export interface ConversationMemoryConfig {
  contextSize: number;
  modelId: string;
  runtimeConfig: Record<string, unknown>;
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
 * 作为 ConversationSession.memory 成员存在（瞬态、进程内投影，可从 DB 重建）；历史压缩（fold）
 * 由 HistoryCompactionService 在本类历史上执行（post-turn，由 CompleteTurnHandler 驱动）。
 */
export class ConversationMemory {
  protected readonly history: Message[];
  protected readonly contextSize: number;
  protected readonly modelId: string;

  constructor(params: {
    history: Message[];
    contextSize: number;
    modelId: string;
  }) {
    this.history = [...params.history];
    this.contextSize = params.contextSize;
    this.modelId = params.modelId;
  }

  /** 增量追加一条消息（turn 的 user/assistant/compact 落盘后由 conv 经会话成员调用）。 */
  append(message: Message): void {
    this.history.push(message);
  }

  /** 原始消息（供历史压缩 fold）。 */
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
