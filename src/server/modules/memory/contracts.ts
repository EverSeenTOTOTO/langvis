import type { Message } from '@/shared/types/entities';

/**
 * memory 域的事件契约（压缩往返）——published language。
 *
 * conv 不再注入 memory 的 HistoryCompactionService 直调；改为：conv 发
 * HistoryCompactionRequested（带 messages+配置），memory 计算（repo-free、数据全在
 * payload）后发 HistoryCompacted，conv 监听持久化 compact 消息。两契约归 memory 拥有
 * （压缩是 memory 的域；payload 仅用 shared 类型，memory 不反向 import conv）→
 * conv→memory 单向、仅类型，比"注入业务服务"严格更干净。
 */

/** conv→memory：请求对某会话历史做压缩（由 complete-turn 在持久化 assistant 终态后发出）。 */
export const HistoryCompactionRequested = 'history_compaction_requested';

export interface HistoryCompactionRequestedPayload {
  conversationId: string;
  messages: Message[];
  contextSize: number;
  runtimeConfig: Record<string, unknown>;
}

/** memory→conv：压缩产物（新 C 的载荷；conv 监听后持久化为 compact 消息）。 */
export const HistoryCompacted = 'history_compacted';

export interface HistoryCompactedPayload {
  conversationId: string;
  content: string;
  startRef: string;
}
