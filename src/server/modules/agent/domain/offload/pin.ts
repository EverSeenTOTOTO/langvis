import { ToolIds } from '@/shared/constants';
import type { LlmMessage } from '@/shared/types/entities';
import type { ParsedAction } from '../port/agent-run-context.port';
import { OBSERVATION_PREFIX, parseAssistantAt } from './offload-stub';

/** 产出须原样驻留上下文的工具：不被 offload 桩化、不被 compaction 折叠（参考资料，模型随时要查）。 */
export const PINNED_TOOLS = new Set<string>([
  ToolIds.LIST_TOOLS,
  ToolIds.SKILL_CALL,
]);

// pinned observation 判定：Observation 前缀 ∧ 配对 assistant action 是 pin 政策命中。
// pin 由配对结构推导，无标记无状态——replay/跨 run 自动保持；显式 pin 未来在谓词 OR 即可。
export function isPinnedObservation(
  messages: readonly LlmMessage[],
  i: number,
  paired?: ParsedAction | null,
): boolean {
  const m = messages[i];
  if (!m || m.role !== 'user' || !m.content.startsWith(OBSERVATION_PREFIX))
    return false;
  const parsed = paired ?? parseAssistantAt(messages, i - 1);
  return parsed !== null && isPinnedAction(parsed);
}

// 恒 pin 走 PINNED_TOOLS；list_tools 条件 pin——仅完整模式（显式 tool 参数查 schema）。
// keywords 简表随时可低成本重查，不值得常驻预算。
function isPinnedAction(parsed: ParsedAction): boolean {
  if (!PINNED_TOOLS.has(parsed.tool)) return false;
  if (parsed.tool === ToolIds.LIST_TOOLS) {
    const arg = parsed.input.tool;
    return typeof arg === 'string' && arg.trim() !== '';
  }
  return true;
}
