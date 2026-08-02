// Barrel：import 触发 @agentHook 自注册，import 序 = 相位执行序。pre-llm：tool-hint → offload → query-budget。
// post-observation：output-offload → compaction → loop-usage；pre-action：cumulative-budget → stuck。
import './tool-hint-hook';
import './offload-hook';
import './query-budget-hook';
import './output-offload-hook';
import './compaction-hook';
import './loop-usage-hook';
import './cumulative-budget-hook';
import './stuck-hook';
import './max-iterations-hook';

export { resolveAgentHooks, agentHook } from './registry';
