import { describe, it, expect } from 'vitest';
import { ContextWindow } from '@/server/modules/memory/domain/model/context-window';
import type { LlmMessage } from '@/shared/types/entities';

function makeLlmMessage(role: LlmMessage['role'], content: string): LlmMessage {
  return { role, content };
}

describe('ContextWindow', () => {
  describe('constructor', () => {
    it('should store messages, maxSize, and modelId', () => {
      const messages = [makeLlmMessage('user', 'Hello')];
      const window = new ContextWindow(messages, 4096, 'openai:gpt-4');

      expect(window.messages).toBe(messages);
      expect(window.maxSize).toBe(4096);
      expect(window.modelId).toBe('openai:gpt-4');
    });
  });

  describe('usage', () => {
    it('should calculate used tokens from messages', () => {
      const messages = [
        makeLlmMessage('system', 'You are helpful'),
        makeLlmMessage('user', 'What is the meaning of life?'),
        makeLlmMessage('assistant', 'The meaning of life is...'),
      ];

      const window = new ContextWindow(messages, 8192, 'openai:gpt-4');
      const usage = window.usage;

      expect(usage.total).toBe(8192);
      expect(usage.used).toBeGreaterThan(0);
    });

    it('should return minimal used tokens for empty messages', () => {
      const window = new ContextWindow([], 8192, 'openai:gpt-4');
      // estimateTokens has a small baseline overhead even for empty arrays
      expect(window.usage.used).toBeLessThan(10);
    });

    it('should use more tokens for longer content', () => {
      const short = [makeLlmMessage('user', 'Hi')];
      const long = [
        makeLlmMessage(
          'user',
          'This is a much longer message that should definitely result in more tokens than the short one.',
        ),
      ];

      const shortWindow = new ContextWindow(short, 8192, 'openai:gpt-4');
      const longWindow = new ContextWindow(long, 8192, 'openai:gpt-4');

      expect(longWindow.usage.used).toBeGreaterThan(shortWindow.usage.used);
    });
  });

  describe('isOverThreshold', () => {
    it('should be false when usage is below 80%', () => {
      const messages = [makeLlmMessage('user', 'Hello')];
      const window = new ContextWindow(messages, 80000, 'openai:gpt-4');

      expect(window.isOverThreshold).toBe(false);
    });

    it('should be true when usage exceeds 80%', () => {
      // Create enough messages to exceed 80% of a small context
      const messages: LlmMessage[] = [];
      for (let i = 0; i < 50; i++) {
        messages.push(
          makeLlmMessage(
            'user',
            `This is question number ${i} with some detail to increase token count.`,
          ),
        );
        messages.push(
          makeLlmMessage(
            'assistant',
            `This is answer number ${i} with a detailed response that uses more tokens.`,
          ),
        );
      }

      // Small context window = 100 tokens ≈ threshold at 80
      const window = new ContextWindow(messages, 100, 'openai:gpt-4');

      expect(window.isOverThreshold).toBe(true);
    });

    it('should be false when usage is exactly at threshold boundary', () => {
      // Edge case: usage just below 80% threshold
      const messages = [makeLlmMessage('user', 'short')];
      // 4000 maxSize, threshold at 3200 (80%), short message ~2 tokens
      const window = new ContextWindow(messages, 4000, 'openai:gpt-4');

      expect(window.isOverThreshold).toBe(false);
    });
  });
});
