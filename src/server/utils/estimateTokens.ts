import type { Message } from '@/shared/types/entities';
import { getEncoding, TiktokenEncoding } from 'js-tiktoken';

// Encoding mapping based on modelId patterns
// cl100k_base: GPT-4, GPT-3.5-turbo, text-embedding-ada-002, etc.
// o200k_base: GPT-4o, GPT-4o-mini, etc.
// o1: o1 series
function getEncodingForModel(modelId: string): TiktokenEncoding {
  const lowerId = modelId.toLowerCase();

  // GPT-4o series uses o200k_base
  if (lowerId.includes('gpt-4o') || lowerId.includes('gpt-4-turbo')) {
    return 'o200k_base';
  }

  // o1 series uses o200k_base
  if (lowerId.startsWith('o1-') || lowerId === 'o1') {
    return 'o200k_base';
  }

  // Default to cl100k_base for GPT-4, GPT-3.5, and others
  return 'cl100k_base';
}

function messageToString(message: Message): string {
  const parts: string[] = [];

  // Role prefix
  parts.push(`${message.role}: ${message.content}`);

  // Include attachments if present
  if (message.attachments && message.attachments.length > 0) {
    for (const attachment of message.attachments) {
      parts.push(
        `[Attachment: ${attachment.filename} (${attachment.mimeType})]`,
      );
    }
  }

  // Include events from meta if present (tool_call, tool_result, etc.)
  if (message.meta?.events && message.meta.events.length > 0) {
    for (const event of message.meta.events) {
      switch (event.type) {
        case 'tool_call':
          parts.push(`[Tool Call: ${event.toolName}]`);
          parts.push(JSON.stringify(event.toolArgs));
          break;
        case 'tool_result':
          parts.push(`[Tool Result: ${event.toolName}]`);
          parts.push(JSON.stringify(event.output));
          break;
        case 'tool_error':
          parts.push(`[Tool Error: ${event.toolName}]`);
          parts.push(event.error);
          break;
        case 'thought':
          parts.push(`[Thought] ${event.content}`);
          break;
      }
    }
  }

  return parts.join('\n');
}

/**
 * Estimate token count for messages using js-tiktoken.
 * Falls back to cl100k_base if model encoding is not recognized.
 */
export function estimateTokens(messages: Message[], modelId: string): number {
  const encodingName = getEncodingForModel(modelId);
  const encoding = getEncoding(encodingName);

  let totalTokens = 0;

  // Messages follow this format: <|start|>{role/name}\n{content}<|end|>\n
  for (const message of messages) {
    // Every message follows <|start|>{role}\n{content}<|end|>\n format
    // Add tokens for special tokens (approximate)
    totalTokens += 4; // <|start|> + role + \n + <|end|> + \n overhead

    const text = messageToString(message);
    const tokens = encoding.encode(text);
    totalTokens += tokens.length;
  }

  // Every reply is primed with <|start|>assistant<|message|>
  totalTokens += 3;

  return totalTokens;
}
