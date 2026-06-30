import type { Message, MessageKind } from '@/shared/types/entities';

/**
 * 历史压缩摘要 C：role=USER, meta={kind:'compact', startRef?}。
 * kind 是消息子类别的统一判别键（与 'context' 并列）。位置即覆盖终点——C 排在被它总结的
 * 消息之后；前端按 meta.kind 过滤，buildContext 原样发出 C 作为有效历史前缀。
 */
export function isCompactionSummary(message: Message): boolean {
  return (message.meta?.kind as MessageKind | undefined) === 'compact';
}

/**
 * 找最后一个压缩摘要 C（滚动折叠模型下，只有"最新且 end≤当前"的那个有效）。
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
