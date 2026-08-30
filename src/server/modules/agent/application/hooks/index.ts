// Barrel：import 触发 @agentHook 自注册，序即相位执行序。pre-action：cumulative-budget → stuck；plus max-iterations。
// pre-llm：tool-hint → trim → micro-compact → query-budget；post-observation：compaction → loop-usage。
import './tool-hint-hook';
import './trim-hook';
import './micro-compact-hook';
import './query-budget-hook';
import './compaction-hook';
import './loop-usage-hook';
import './cumulative-budget-hook';
import './stuck-hook';
import './max-iterations-hook';

export { resolveAgentHooks, agentHook } from './registry';
