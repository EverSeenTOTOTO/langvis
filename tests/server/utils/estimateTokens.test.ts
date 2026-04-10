import { describe, expect, it } from 'vitest';
import { estimateTokens } from '@/server/utils/estimateTokens';
import type { Message } from '@/shared/types/entities';
import { Role } from '@/shared/types/entities';

describe('estimateTokens', () => {
  const createMessage = (
    role: Role,
    content: string,
    meta?: Message['meta'],
  ): Message => ({
    id: 'msg_test',
    role,
    content,
    meta,
    createdAt: new Date(),
    conversationId: 'conv_test',
  });

  describe('basic estimation', () => {
    it('should estimate tokens for a simple user message', () => {
      const messages = [createMessage(Role.USER, 'Hello, world!')];
      const tokens = estimateTokens(messages, 'openai:gpt-4');

      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(50); // Simple message should be small
    });

    it('should return more tokens for longer content', () => {
      const shortMessages = [createMessage(Role.USER, 'Hi')];
      const longMessages = [
        createMessage(
          Role.USER,
          'This is a much longer message that should definitely result in more tokens than the short one.',
        ),
      ];

      const shortTokens = estimateTokens(shortMessages, 'openai:gpt-4');
      const longTokens = estimateTokens(longMessages, 'openai:gpt-4');

      expect(longTokens).toBeGreaterThan(shortTokens);
    });

    it('should accumulate tokens for multiple messages', () => {
      const oneMessage = [createMessage(Role.USER, 'Hello')];
      const twoMessages = [
        createMessage(Role.USER, 'Hello'),
        createMessage(Role.ASSIST, 'Hi there!'),
      ];

      const oneTokens = estimateTokens(oneMessage, 'openai:gpt-4');
      const twoTokens = estimateTokens(twoMessages, 'openai:gpt-4');

      expect(twoTokens).toBeGreaterThan(oneTokens);
    });
  });

  describe('model encoding selection', () => {
    it('should use cl100k_base for GPT-4', () => {
      const messages = [createMessage(Role.USER, 'Test message')];
      const tokens = estimateTokens(messages, 'openai:gpt-4');

      expect(tokens).toBeGreaterThan(0);
    });

    it('should use o200k_base for GPT-4o', () => {
      const messages = [createMessage(Role.USER, 'Test message')];
      const tokens = estimateTokens(messages, 'openai:gpt-4o');

      expect(tokens).toBeGreaterThan(0);
    });

    it('should fallback to cl100k_base for unknown models', () => {
      const messages = [createMessage(Role.USER, 'Test message')];
      const tokens = estimateTokens(messages, 'unknown:model');

      expect(tokens).toBeGreaterThan(0);
    });
  });

  describe('message with metadata', () => {
    it('should not count meta.events in estimation', () => {
      const simpleMessage = createMessage(Role.ASSIST, 'Final answer');
      const messageWithEvents = createMessage(Role.ASSIST, 'Final answer', {
        events: [
          {
            type: 'tool_call',
            messageId: 'msg_test',
            callId: 'tc_1',
            toolName: 'test_tool',
            toolArgs: { query: 'some argument' },
            seq: 1,
            at: Date.now(),
          },
        ],
      });

      const simpleTokens = estimateTokens([simpleMessage], 'openai:gpt-4');
      const eventsTokens = estimateTokens([messageWithEvents], 'openai:gpt-4');

      // meta.events are UI-only data and should not affect token estimation
      expect(eventsTokens).toBe(simpleTokens);
    });

    it('should count attachments in estimation', () => {
      const messageWithoutAttachment = createMessage(Role.USER, 'Check this');
      const messageWithAttachment = createMessage(Role.USER, 'Check this');
      messageWithAttachment.attachments = [
        { filename: 'photo.png', mimeType: 'image/png', url: 'https://example.com/photo.png' },
      ];

      const withoutTokens = estimateTokens([messageWithoutAttachment], 'openai:gpt-4');
      const withTokens = estimateTokens([messageWithAttachment], 'openai:gpt-4');

      expect(withTokens).toBeGreaterThan(withoutTokens);
    });
  });

  describe('edge cases', () => {
    it('should handle empty message array', () => {
      const tokens = estimateTokens([], 'openai:gpt-4');
      // Should return just the overhead for assistant priming (3 tokens)
      expect(tokens).toBe(3);
    });

    it('should handle empty content', () => {
      const messages = [createMessage(Role.USER, '')];
      const tokens = estimateTokens(messages, 'openai:gpt-4');

      expect(tokens).toBeGreaterThan(0);
    });

    it('should handle special characters', () => {
      const messages = [createMessage(Role.USER, 'Hello 🎉 你好 مرحبا')];
      const tokens = estimateTokens(messages, 'openai:gpt-4');

      expect(tokens).toBeGreaterThan(0);
    });
  });
});
