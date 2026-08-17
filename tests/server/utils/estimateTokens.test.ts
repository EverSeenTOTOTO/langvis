import { describe, expect, it } from 'vitest';
import { estimateTokens } from '@/server/utils/estimateTokens';
import { getEncoding } from 'js-tiktoken';
import type { Message } from '@/shared/types/entities';
import { Role } from '@/shared/types/entities';

describe('estimateTokens', () => {
  const createMessage = (role: Role, content: string): Message => ({
    id: 'msg_test',
    role,
    content,
    createdAt: new Date(),
    conversationId: 'conv_test',
  });

  describe('basic estimation', () => {
    it('should estimate tokens for a simple user message', () => {
      const tokens = estimateTokens([
        createMessage(Role.USER, 'Hello, world!'),
      ]);

      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(50); // Simple message should be small
    });

    it('should return more tokens for longer content', () => {
      const shortTokens = estimateTokens([createMessage(Role.USER, 'Hi')]);
      const longTokens = estimateTokens([
        createMessage(
          Role.USER,
          'This is a much longer message that should definitely result in more tokens than the short one.',
        ),
      ]);

      expect(longTokens).toBeGreaterThan(shortTokens);
    });

    it('should accumulate tokens for multiple messages', () => {
      const oneTokens = estimateTokens([createMessage(Role.USER, 'Hello')]);
      const twoTokens = estimateTokens([
        createMessage(Role.USER, 'Hello'),
        createMessage(Role.ASSIST, 'Hi there!'),
      ]);

      expect(twoTokens).toBeGreaterThan(oneTokens);
    });
  });

  describe('message with metadata', () => {
    it('should count attachments in estimation', () => {
      const messageWithoutAttachment = createMessage(Role.USER, 'Check this');
      const messageWithAttachment = createMessage(Role.USER, 'Check this');
      messageWithAttachment.attachments = [
        {
          filename: 'photo.png',
          mimeType: 'image/png',
          url: 'https://example.com/photo.png',
        },
      ];

      const withoutTokens = estimateTokens([messageWithoutAttachment]);
      const withTokens = estimateTokens([messageWithAttachment]);

      expect(withTokens).toBeGreaterThan(withoutTokens);
    });
  });

  describe('edge cases', () => {
    it('should handle empty message array', () => {
      // 仅 assistant 启动开销（3 tokens）
      expect(estimateTokens([])).toBe(3);
    });

    it('should handle empty content', () => {
      expect(estimateTokens([createMessage(Role.USER, '')])).toBeGreaterThan(0);
    });

    it('should handle special characters', () => {
      expect(
        estimateTokens([createMessage(Role.USER, 'Hello 🎉 你好 مرحبا')]),
      ).toBeGreaterThan(0);
    });
  });

  // 分块编码只允许有界偏差（估算本就是压缩阈值/用量的单调代理）：与整体 tiktoken
  // 编码的相对误差 ≤6%（空白切点为天然边界，英文/代码实测 0 偏差）。
  describe('chunked encoding equivalence', () => {
    const encoding = getEncoding('cl100k_base');
    const direct = (content: string) =>
      encoding.encode(`user: ${content}`).length + 4;

    it.each([
      [
        'english prose',
        'The quick brown fox jumps over the lazy dog. '.repeat(20),
      ],
      ['cjk', '这是一段比较长的中文文本用来测试分词性能问题'.repeat(5)],
      ['code', 'const x = await fetch(url); // comment\n'.repeat(10)],
      ['pathological run', 'x'.repeat(500)],
    ])('stays within 6% of direct encoding for %s', (_name, content) => {
      const chunked = estimateTokens([createMessage(Role.USER, content)]) - 3;
      const exact = direct(content);
      expect(Math.abs(chunked - exact) / exact).toBeLessThanOrEqual(0.06);
    });
  });
});
