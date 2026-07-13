// Barrel：import 触发各 hook 的 @agentHook 自注册；executor 经此 import resolveAgentHooks。
import './compaction-hook';
import './process-summary-hook';
import './loop-usage-hook';
import './budget-hook';

export { resolveAgentHooks, agentHook } from './registry';
