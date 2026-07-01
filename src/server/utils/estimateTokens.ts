import type { LlmMessage } from '@/shared/types/entities';
import { getEncoding } from 'js-tiktoken';

/** 上下文用量：已用 token / 总额。被 conv（会话层）与 memory（loop 层）共用。 */
export type ContextUsage = {
  used: number;
  total: number;
};

// 固定 encoding：token 估算仅用于压缩阈值与会话用量百分比，需要稳定单调代理而非精确值——
// tiktoken 仅有 OpenAI encoding，per-model 配置只是虚假精度。cl100k_base 对多数模型是合理近似。
const encoding = getEncoding('cl100k_base');

function messageToString(message: LlmMessage): string {
  const parts: string[] = [];

  parts.push(`${message.role}: ${message.content}`);

  if (message.attachments && message.attachments.length > 0) {
    for (const attachment of message.attachments) {
      parts.push(
        `[Attachment: ${attachment.filename} (${attachment.mimeType})]`,
      );
    }
  }

  return parts.join('\n');
}

/** 估算消息 token 数（固定 cl100k_base encoding）。 */
export function estimateTokens(messages: LlmMessage[]): number {
  let totalTokens = 0;

  for (const message of messages) {
    // <|start|>{role}\n{content}<|end|>\n 每条消息固定开销。
    totalTokens += 4;
    totalTokens += encoding.encode(messageToString(message)).length;
  }

  // 回复启动令牌 <|start|>assistant<|message|>。
  totalTokens += 3;

  return totalTokens;
}
