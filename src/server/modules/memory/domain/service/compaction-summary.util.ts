import type { Message } from '@/shared/types/entities';

/**
 * 历史压缩摘要 C 在 Message.meta 上的判别键。
 *
 * C 复用既有 hidden-Message 模式：role=USER, meta={hidden:true, kind:'compaction_summary', startRef?}。
 * 位置即覆盖终点（C 排在被它总结的消息之后），前端已过滤 hidden（Messages.tsx），
 * buildContext 原样发出，groupIntoTurns 跳过。零 schema 变更。
 */
export const COMPACTION_SUMMARY_KIND = 'compaction_summary';

export function isCompactionSummary(message: Message): boolean {
  return message.meta?.kind === COMPACTION_SUMMARY_KIND;
}

/**
 * 在有序消息里找最后一个压缩摘要 C（滚动折叠模型下，只有"最新且 end≤当前"的那个有效）。
 * 返回该消息与其下标；无则 summary=null / index=-1。被 buildContext 与 HistoryCompaction 共用。
 */
export function findLatestCompactionSummary(messages: Message[]): {
  summary: Message | null;
  index: number;
} {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isCompactionSummary(messages[i])) {
      return { summary: messages[i], index: i };
    }
  }
  return { summary: null, index: -1 };
}
