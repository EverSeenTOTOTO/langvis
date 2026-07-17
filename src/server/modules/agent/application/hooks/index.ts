// Barrel：import 触发各 hook 的 @agentHook 自注册；executor 经此 import resolveAgentHooks。
// import 序 = 各相位内执行序（tsyringe resolveAll 保插入序）：
// pre-llm：tool-hint → offload（无损落盘）→ query-budget（有损超限兜底）；无损优先，有损垫后。
// post-observation：offload 须先于 compaction（有损 fold）——无损优先，且 fold 不该吃掉 $cached 句柄。
// post-llm：cumulative-budget（累计 token 用量兜底）。
// process-summary 已迁至 conv 侧 ProcessSummaryTransform（turn-end），此处不再注册 loop-exit hook。
import './tool-hint-hook';
import './offload-hook';
import './query-budget-hook';
import './compaction-hook';
import './loop-usage-hook';
import './budget-hook';
import './stuck-hook';
import './max-iterations-hook';

export { resolveAgentHooks, agentHook } from './registry';
