import type { LlmMessage, Message, MessageKind } from '@/shared/types/entities';
import { Role } from '@/shared/entities/Message';

export function toLlmMessages(messages: Message[]): LlmMessage[] {
  return messages.map(m => ({ role: m.role, content: m.content }));
}

/** 压缩摘要 C：role=USER, meta.kind='compact'（与 'context' 并列的脚手架判别键）。 */
export function isCompactionSummary(message: Message): boolean {
  return (message.meta?.kind as MessageKind | undefined) === 'compact';
}

/**
 * 找最后一个压缩摘要 C（滚动折叠模型下，只有"最新且 end≤当前"的那个有效）。
 * 位置即覆盖终点——C 排在被它总结的消息之后，projectToLlmMessages 原样发出 C 作为有效历史前缀。
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

export function groupIntoTurns(messages: Message[]): Message[][] {
  const turns: Message[][] = [];
  let current: Message[] = [];

  for (const msg of messages) {
    if (msg.role === Role.SYSTEM) continue;
    // 任何带 meta.kind 的都是脚手架（context/compact），非对话 turn。
    if (msg.meta?.kind) continue;

    current.push(msg);

    if (msg.role === Role.ASSIST) {
      turns.push(current);
      current = [];
    }
  }

  if (current.length > 0) {
    turns.push(current);
  }

  return turns;
}

/**
 * 投影有效历史为 LLM 上下文：system + 会话上下文恒发 → 最新 C 作前缀 → 其后 turn。
 * 不含 processSummary 拼接——那是 summary-bake transform 的职责，调用前已烘进 messages。
 */
export function projectToLlmMessages(messages: Message[]): LlmMessage[] {
  const out: LlmMessage[] = [];

  for (const msg of messages) {
    if (msg.role === Role.SYSTEM) {
      out.push({ role: 'system', content: msg.content });
    } else if (
      msg.role === Role.USER &&
      (msg.meta?.kind as MessageKind | undefined) === 'context'
    ) {
      out.push({ role: 'user', content: msg.content });
    }
  }

  const { summary, index } = findLatestCompactionSummary(messages);
  const tail = summary ? messages.slice(index + 1) : messages;
  if (summary) {
    out.push({ role: 'user', content: summary.content });
  }

  for (const turn of groupIntoTurns(tail)) {
    for (const msg of turn) {
      out.push({ role: msg.role as LlmMessage['role'], content: msg.content });
    }
  }

  return out;
}
