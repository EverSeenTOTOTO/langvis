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
 * 技能元信息。来自 `skills/<id>/skill.md` 的 front matter；客户端技能选择器消费。
 */
export interface SkillInfo {
  id: string;
  name: string;
  description: string;
}
