// Barrel：import 触发各 hook 的 @agentHook 自注册；executor 经此 import resolveAgentHooks。
// import 序 = post-observation 内执行序（tsyringe resolveAll 保插入序）：
// offload（无损落盘）须先于 compaction（有损 fold）——无损优先，且 fold 不该吃掉 $cached 句柄。
// process-summary 已迁至 conv 侧 ProcessSummaryTransform（turn-end），此处不再注册 loop-exit hook。
import './offload-hook';
import './compaction-hook';
import './loop-usage-hook';
import './budget-hook';
import './stuck-hook';
import './max-iterations-hook';

export { resolveAgentHooks, agentHook } from './registry';
