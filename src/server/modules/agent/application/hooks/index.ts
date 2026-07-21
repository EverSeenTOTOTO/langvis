// Barrel：import 触发 @agentHook 自注册。import 序 = 相位内执行序（resolveAll 保插入序）。
// pre-llm: tool-hint → offload → query-budget
// post-observation: compaction
// pre-action: cumulative-budget → stuck（loop 权威解析后挂 ctx.pendingAction，直读不 re-parse）
// process-summary 在 conv 侧 ProcessSummaryTransform（turn-end），此处不注册 loop-exit hook。
import './tool-hint-hook';
import './offload-hook';
import './query-budget-hook';
import './compaction-hook';
import './loop-usage-hook';
import './cumulative-budget-hook';
import './stuck-hook';
import './max-iterations-hook';

export { resolveAgentHooks, agentHook } from './registry';
