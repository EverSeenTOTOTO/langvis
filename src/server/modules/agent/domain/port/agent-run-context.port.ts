import type { RuntimeConfigVO } from '../model/runtime-config.vo';
import type { AgentRun } from '../model/agent-run.entity';
import type { LlmMessage } from '@/shared/types/entities';
import type { RunEvent } from '@/shared/types/events';
import type { LlmPort } from './llm.port';
import type { CachePort } from './cache.port';

/**
 * AgentRunContext — agent 执行所需的上下文契约（port）。
 *
 * 取代旧设计里"把 AgentRun 当 context bag 传给 agent"。
 * agent 依赖此 port，不再依赖 AgentRun 聚合根本身 —— 聚合根只记录事实，
 * 执行所需的依赖（llm/cache/signal/工具调用）由 AgentRunExecutor 在此 context 上装配。
 *
 * 不含 messageId —— 那是 Conversation BC 概念，工具缓存键用 runId。
 * 极少数需要 message 关联的工具（如 AskUser）经由 executeTool 闭包获得，
 * 不污染 agent 面向的契约。
 */
export interface AgentRunContext {
  readonly run: AgentRun;
  readonly config: RuntimeConfigVO;
  readonly agentId: string;
  readonly runId: string;
  readonly workDir: string;
  readonly signal: AbortSignal;
  readonly llm: LlmPort;
  readonly cache: CachePort;

  buildContext(): Promise<LlmMessage[]>;
  contextUsage(): { used: number; total: number };

  /**
   * 工具调用 —— yield 原始 RunEvent (tool_call/tool_progress/tool_result/tool_error)，
   * 返回 observation。事件由 executor 统一 append + 富化。
   */
  executeTool(
    toolName: string,
    args: Record<string, unknown>,
  ): AsyncGenerator<RunEvent, string, void>;
}
