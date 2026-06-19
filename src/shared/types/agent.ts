/**
 * Agent 上下文领域类型。
 *
 * @see docs/plans/2026-05-30-ddd-refactor/02-agent-run.md
 */

/**
 * AgentRun 生命周期状态。
 */
export type RunStatus =
  | 'initialized'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * 上下文契约 — Conversation 上下文与 Agent 上下文之间的值对象。
 *
 * agentId 指向 Agent 注册 token（如 AgentIds.CHAT）。
 * config 是未经 agent.configSchema 验证的用户配置，在 RuntimeConfigVO.create() 时校验 + 补默认值。
 */
export type AgentBinding = {
  agentId: string;
  config: Record<string, unknown>;
};

/**
 * Conversation 聚合根持有的配置。
 */
export type ConversationConfig = {
  agentBinding: AgentBinding;
};
