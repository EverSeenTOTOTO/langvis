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

// js-tiktoken 的 BPE 对无边界长串（CJK、连续字母）是 O(n²)（3300 汉字 ≈ 7s），会同步阻塞事件循环。
// 按 ≤16 字符分块编码压回线性：切点优先取空白（天然 token 边界，实测 0 误差），无边界的长串才硬切（实测 0 误差）。
const ENCODE_CHUNK = 16;

function encodeChunked(text: string): number {
  let tokens = 0;
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + ENCODE_CHUNK, text.length);
    if (end < text.length) {
      for (let j = end; j > start + 4; j--) {
        const c = text[j];
        if (c === ' ' || c === '\n' || c === '\t') {
          end = j;
          break;
        }
      }
    }
    tokens += encoding.encode(text.slice(start, end)).length;
    start = end;
  }
  return tokens;
}

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
export function estimateTokens(messages: readonly LlmMessage[]): number {
  let totalTokens = 0;

  for (const message of messages) {
    // <|start|>{role}\n{content}<|end|>\n 每条消息固定开销。
    totalTokens += 4;
    totalTokens += encodeChunked(messageToString(message));
  }

  // 回复启动令牌 <|start|>assistant<|message|>。
  totalTokens += 3;

  return totalTokens;
}
