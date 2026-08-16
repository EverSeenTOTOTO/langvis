import { Role, type Message } from '@/shared/types/entities';

/** 可重试的用户消息：真实 user 输入，排除会话上下文头与折叠摘要（均为 USER 角色的脚手架）。 */
export function isResumableMessage(m: Message): boolean {
  return (
    m.role === Role.USER &&
    m.content.trim() !== '' &&
    m.meta?.kind !== 'context' &&
    m.meta?.kind !== 'compact'
  );
}

/** 会话内可重试用户消息，时间倒序（newest 在前）。 */
export function findResumableMessages(messages: Message[]): Message[] {
  return messages.filter(isResumableMessage).reverse();
}
