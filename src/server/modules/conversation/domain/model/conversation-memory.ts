import type { LlmMessage, Message, MessageKind } from '@/shared/types/entities';
import { Role } from '@/shared/entities/Message';
import { estimateTokens } from '@/server/utils/estimateTokens';
import type { ContextUsage } from '@/server/utils/estimateTokens';
import type { HistoryCompactionConfig } from '../../application/service/history-config.fragment';
import { fold } from '@/server/libs/compaction';
import { MessageList } from '@/server/libs/messages';
import { Prompt } from '@/server/libs/prompt';
import { winstonLogger } from '@/server/utils/logger';

/** 会话记忆激活配置（激活时灌入，ConversationSession 持有）。 */
export interface ConversationMemoryConfig {
  contextSize: number;
  runtimeConfig: Record<string, unknown>;
}

/** 历史压缩（fold）产物：新 C 载荷 + 压缩后用量。 */
export interface ConversationCompactionResult {
  content: string;
  startRef: string;
  usage: ContextUsage;
}

/**
 * 会话的持久消息模型（ConversationSession 成员实体，贫血：状态 MessageList monad + 编排接缝）。
 * 有效历史 = [最新压缩摘要 C, 其后 turn]；不做硬截断。用量与 buildContext 同口径。
 *
 * processSummary 不再放 message.meta：它是 run-scoped 派生属性，存 AgentRun.processSummary；
 * buildContext 的消费者 transform 按 assistant 消息的 agentRunId 取回、前缀 <summary>（富在 join 端）。
 * 自维护历史压缩（fold 原语来自 libs/compaction，与 agent 的 WorkingMemory 同机制），
 * 返回载荷不含持久化——落盘 compact 消息是 CompleteTurnHandler 的职责，避免反向依赖 message repo。
 */
export class ConversationMemory {
  protected history: MessageList<Message>;
  protected readonly contextSize: number;
  protected readonly compaction: HistoryCompactionConfig;
  private readonly logger = winstonLogger.child({
    source: 'ConversationMemory',
  });

  constructor(params: {
    history: Message[];
    contextSize: number;
    runtimeConfig: Record<string, unknown>;
  }) {
    this.history = MessageList.of(params.history);
    this.contextSize = params.contextSize;
    this.compaction = (
      params.runtimeConfig as { history: HistoryCompactionConfig }
    ).history;
  }

  append(message: Message): void {
    this.history = this.history.append(message);
  }

  getMessages(): Message[] {
    return this.history.toArray();
  }

  /**
   * 投影有效历史为 LLM 上下文。消费者 transform 先把 processSummary（按 agentRunId 从 AgentRun 取）
   * 前缀到 assistant 消息，再投影：system + 会话上下文恒发 → 最新 C 作前缀 → 其后 turn。
   */
  async buildContext(
    processSummaries: ReadonlyMap<string, string> = new Map(),
  ): Promise<LlmMessage[]> {
    // 消费者 transform：assistant 消息按 agentRunId 取 processSummary、前缀 <summary>
    const history = this.history
      .map(msg => {
        if (msg.role !== Role.ASSIST || !msg.agentRunId) return msg;
        const ps = processSummaries.get(msg.agentRunId);
        return ps
          ? { ...msg, content: `<summary>${ps}</summary>\n\n${msg.content}` }
          : msg;
      })
      .toArray();

    const messages: LlmMessage[] = [];

    // system + 会话上下文（meta.kind === 'context'），始终发出。
    for (const msg of history) {
      if (msg.role === Role.SYSTEM) {
        messages.push({ role: 'system', content: msg.content });
      } else if (
        msg.role === Role.USER &&
        (msg.meta?.kind as MessageKind | undefined) === 'context'
      ) {
        messages.push({ role: 'user', content: msg.content });
      }
    }

    // C 作为有效历史前缀，替代被它总结的早期 turn（基于带 summary 的 history 快照）。
    const { summary, index } = findLatestCompactionSummary(history);
    const tail = summary ? history.slice(index + 1) : history;
    if (summary) {
      messages.push({ role: 'user', content: summary.content });
    }

    for (const turn of this.groupIntoTurns(tail)) {
      for (const msg of turn) {
        messages.push({
          role: msg.role as LlmMessage['role'],
          content: msg.content,
        });
      }
    }

    return messages;
  }

  getContextUsage(): ContextUsage {
    const { summary, tail } = this.getEffectiveTurns();
    const effective = summary ? [summary, ...tail] : tail;
    return {
      used: estimateTokens(effective as unknown as LlmMessage[]),
      total: this.contextSize,
    };
  }

  /**
   * 历史层压缩（fold）：有效历史用量超阈时把「上一个 C + tail」滚动折叠成新 C。
   * 不含持久化（落盘是 CompleteTurnHandler 的职责）；未超阈或 fold 返回空时返回 null。
   */
  async compact(
    signal: AbortSignal,
  ): Promise<ConversationCompactionResult | null> {
    if (!this.contextSize) return null;

    const history = this.history.toArray();
    const { summary, index } = findLatestCompactionSummary(history);
    const tail = summary ? history.slice(index + 1) : history;
    if (tail.length === 0) return null;

    const effective = summary ? [summary, ...tail] : tail;
    const used = estimateTokens(toLlmMessages(effective));
    if (used <= this.contextSize * this.compaction.threshold) return null;

    this.logger.info(
      `History over threshold (${used}/${this.contextSize}, ${(this.compaction.threshold * 100).toFixed(0)}%) — compacting ${tail.length} messages`,
    );

    const tailMessages = toLlmMessages(tail);
    // 既有摘要 C 作为 messages[0] 续接（fold 内部滚动折叠，无需单独 prevSummary）。
    const messages = summary
      ? [{ role: 'user' as const, content: summary.content }, ...tailMessages]
      : tailMessages;
    const content = await fold({
      messages,
      windowSize: this.compaction.windowSize,
      signal,
      prompt: HISTORY_PROMPT,
    });

    if (!content) return null;

    // 压缩后有效历史 = [新 C]；其用量即会话层用量。
    return {
      content,
      startRef: summary?.id ?? history[0]?.id ?? '',
      usage: {
        used: estimateTokens([{ role: 'user', content }]),
        total: this.contextSize,
      },
    };
  }

  /** 有效历史 = 最新 C + 其后 turn；buildContext 与 getContextUsage 共用，保证口径一致。 */
  protected getEffectiveTurns(): { summary: Message | null; tail: Message[] } {
    const history = this.history.toArray();
    const { summary, index } = findLatestCompactionSummary(history);
    const tail = summary ? history.slice(index + 1) : history;
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

const HISTORY_PROMPT = Prompt.empty()
  .with('Role', 'You are a conversation compactor.')
  .with(
    'Instructions',
    'Fold the history below into a concise summary, incorporating any previous summary at the start. Preserve: who, when, did what, plus key facts and open items. Keep it concise and chronological; do not fabricate.',
  )
  .with('History', '')
  .with(
    'Output',
    'Output the summary directly (no extra explanation, no Markdown headings).',
  );

/** 压缩摘要 C：role=USER, meta.kind='compact'（与 'context' 并列的脚手架判别键）。 */
function isCompactionSummary(message: Message): boolean {
  return (message.meta?.kind as MessageKind | undefined) === 'compact';
}

/**
 * 找最后一个压缩摘要 C（滚动折叠模型下，只有"最新且 end≤当前"的那个有效）。
 * 位置即覆盖终点——C 排在被它总结的消息之后，buildContext 原样发出 C 作为有效历史前缀。
 */
function findLatestCompactionSummary(messages: Message[]): {
  summary: Message | null;
  index: number;
} {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isCompactionSummary(messages[i])) {
      return { summary: messages[i], index: i };
    }
  }
  return { summary: null, index: -1 };
}
