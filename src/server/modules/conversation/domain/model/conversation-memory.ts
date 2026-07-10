import type { LlmMessage, Message } from '@/shared/types/entities';
import { Role } from '@/shared/entities/Message';
import { estimateTokens } from '@/server/utils/estimateTokens';
import type { ContextUsage } from '@/server/utils/estimateTokens';
import type { HistoryCompactionConfig } from '../../application/service/history-config.fragment';
import { fold } from '@/server/libs/compaction';
import { ListMonad } from '@/server/libs/list';
import { Prompt } from '@/server/libs/prompt';
import { winstonLogger } from '@/server/utils/logger';
import {
  findLatestCompactionSummary,
  toLlmMessages,
  projectToLlmMessages,
  computeContextUsage,
} from './history-projection';

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
 * 会话的持久消息模型（ConversationSession 成员实体，贫血：状态 ListMonad monad + 编排接缝）。
 * 有效历史 = [最新压缩摘要 C, 其后 turn]；不做硬截断。用量与 buildContext 同口径。
 *
 * processSummary 不再放 message.meta：它是 run-scoped 派生属性，存 AgentRun.processSummary；
 * buildContext 的消费者 transform 按 assistant 消息的 agentRunId 取回、前缀 <summary>（富在 join 端）。
 * 自维护历史压缩（fold 原语来自 libs/compaction，与 agent 侧同机制），
 * 返回载荷不含持久化——落盘 compact 消息是 CompleteTurnHandler 的职责，避免反向依赖 message repo。
 */
export class ConversationMemory {
  protected history: ListMonad<Message>;
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
    this.history = ListMonad.of(params.history);
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

    return projectToLlmMessages(history);
  }

  getContextUsage(): ContextUsage {
    return computeContextUsage(this.history.toArray(), this.contextSize);
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
