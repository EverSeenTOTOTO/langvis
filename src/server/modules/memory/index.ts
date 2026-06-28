/**
 * memory 模块对外发布的边界——agent / conversation 等兄弟模块统一从本 barrel 导入，
 * 取代直写 domain/...、application/... 深路径。单向依赖（agent/conversation → memory）。
 *
 * memory 域内部仍用相对路径互引；此处只暴露公共表面。
 * HistoryCompactionService 不再对外——压缩由本域 handler 自驱动（监听 HistoryCompactionRequested），
 * 兄弟模块只经事件契约（contracts）与 memory 交互。
 */
export type { ContextPort } from './domain/port/context.port';
export { ConversationMemory } from './domain/model/conversation-memory';
export { WorkingMemory } from './domain/model/working-memory';
export { MEMORY_FRAGMENT } from './domain/service/compaction-config';
export { HistoryCompactionRequested, HistoryCompacted } from './contracts';
export type {
  HistoryCompactionRequestedPayload,
  HistoryCompactedPayload,
} from './contracts';
