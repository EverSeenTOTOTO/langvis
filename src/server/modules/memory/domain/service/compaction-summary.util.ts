import type { Message, MessageKind } from '@/shared/types/entities';

/**
 * 历史压缩摘要 C：role=USER, meta={kind:'compact', startRef?}。
 *
 * kind 是消息子类别的统一判别键（与 'context' 并列，meta.hidden 已废弃）。
 * 位置即覆盖终点（C 排在被它总结的消息之后）；前端按 meta.kind 过滤（Messages.tsx），
 * buildContext 原样发出，groupIntoTurns 跳过任何 meta.kind。
 */
export function isCompactionSummary(message: Message): boolean {
  return (message.meta?.kind as MessageKind | undefined) === 'compact';
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
