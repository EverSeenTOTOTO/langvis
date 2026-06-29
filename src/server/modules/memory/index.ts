/**
 * memory 模块对外发布的边界——agent / conversation 等兄弟模块统一从本 barrel 导入。
 * 单向依赖（agent/conversation → memory）；memory 不反向 import 任何兄弟模块。
 *
 * memory 的对外表面是两个同步 Customer-Supplier 端口（逻辑归 memory，消费方经端口使用）：
 *  - LoopMemoryPort / LOOP_MEMORY_PORT：agent 的 ReAct loop 经此操作 WorkingMemory（runId 索引）。
 *  - ConversationMemoryPort / CONVERSATION_MEMORY_PORT：conv 经此操作 ConversationMemory
 *    （conversationId 索引——激活/追加/取种子/用量/压缩，类似 LoopMemoryPort 之于 WorkingMemory）。
 * 另：LoopUsageReported（memory→conv，loop 用量自报，仅 runId）。
 * memory 不监听任何 conv/agent 事件——只实现端口、自发 loop 用量。
 */
export { LOOP_MEMORY_PORT } from './domain/port/loop-memory.port';
export type {
  LoopMemoryPort,
  LoopMemoryConfig,
} from './domain/port/loop-memory.port';
export { CONVERSATION_MEMORY_PORT } from './domain/port/conversation-memory.port';
export type {
  ConversationMemoryPort,
  ConversationMemoryConfig,
  ConversationCompactionResult,
} from './domain/port/conversation-memory.port';
export { LoopUsageReported } from './contracts';
export type { LoopUsageReportedPayload } from './contracts';
