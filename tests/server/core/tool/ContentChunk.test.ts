import ContentChunkTool from '@/server/core/tool/ContentChunk';
import type { ContentChunkOutput } from '@/server/core/tool/ContentChunk/config';
import logger from '@/server/utils/logger';
import { AgentEvent } from '@/shared/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockContext } from '../../helpers/context';

vi.mock('@/server/utils/logger', () => {
  const mockLogger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  };
  mockLogger.child.mockReturnValue(mockLogger);
  return {
    default: mockLogger,
  };
});

async function collectEvents(
  generator: AsyncGenerator<AgentEvent, ContentChunkOutput, void>,
): Promise<{
  progress: Array<{ message?: string; data?: unknown }>;
  result: ContentChunkOutput | null;
}> {
  const progress: Array<{ message?: string; data?: unknown }> = [];
  let result: ContentChunkOutput | null = null;

  while (true) {
    const { done, value } = await generator.next();
    if (done) {
      result = value ?? null;
      break;
    }
    if (value.type === 'tool_progress') {
      progress.push(value.data as { message?: string; data?: unknown });
    }
  }
  return { progress, result };
}

describe('ContentChunkTool', () => {
  let chunkTool: ContentChunkTool;

  beforeEach(() => {
    vi.clearAllMocks();
    chunkTool = new ContentChunkTool();
    (chunkTool as any).logger = logger;
  });

  describe('call', () => {
    it('should chunk content using paragraph strategy by default', async () => {
      const content =
        'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.';
      const ctx = createMockContext();
      const { progress, result } = await collectEvents(
        chunkTool.call({ content }, ctx),
      );

      expect(progress).toHaveLength(1);
      expect(result).not.toBeNull();
      expect(result!.chunks).toHaveLength(1);
      expect(result!.chunks[0].content).toBe(content);
    });

    it('should respect maxChunkSize option', async () => {
      const content = 'A'.repeat(500) + '\n\n' + 'B'.repeat(600);
      const ctx = createMockContext();
      const { result } = await collectEvents(
        chunkTool.call(
          {
            content,
            strategy: 'paragraph',
            options: { maxChunkSize: 400 },
          },
          ctx,
        ),
      );

      expect(result).not.toBeNull();
      expect(result!.chunks.length).toBeGreaterThan(2);
    });

    it('should use fixed strategy when specified', async () => {
      const content = 'A'.repeat(2000);
      const ctx = createMockContext();
      const { progress, result } = await collectEvents(
        chunkTool.call(
          {
            content,
            strategy: 'fixed',
            options: { maxChunkSize: 500 },
          },
          ctx,
        ),
      );

      expect(progress).toHaveLength(1);
      expect(progress[0].message).toContain('fixed');

      expect(result).not.toBeNull();
      expect(result!.chunks.length).toBe(4);
      expect(result!.chunks[0].content.length).toBe(500);
    });

    it('should handle overlap option in fixed strategy', async () => {
      const content = 'A'.repeat(1000);
      const ctx = createMockContext();
      const { result } = await collectEvents(
        chunkTool.call(
          {
            content,
            strategy: 'fixed',
            options: { maxChunkSize: 500, overlap: 100 },
          },
          ctx,
        ),
      );

      expect(result).not.toBeNull();
      expect(result!.chunks.length).toBeGreaterThan(2);
    });

    it('should throw error for unknown strategy', async () => {
      const content = 'Some content';
      const ctx = createMockContext();

      await expect(
        collectEvents(
          chunkTool.call({ content, strategy: 'unknown' as any }, ctx),
        ),
      ).rejects.toThrow('Unknown chunk strategy "unknown"');
    });

    it('should handle empty content', async () => {
      const content = '';
      const ctx = createMockContext();
      const { result } = await collectEvents(chunkTool.call({ content }, ctx));

      expect(result).not.toBeNull();
      expect(result!.chunks).toHaveLength(0);
    });

    it('should handle single paragraph', async () => {
      const content = 'Single paragraph without breaks.';
      const ctx = createMockContext();
      const { result } = await collectEvents(chunkTool.call({ content }, ctx));

      expect(result).not.toBeNull();
      expect(result!.chunks).toHaveLength(1);
      expect(result!.chunks[0].content).toBe(content);
    });

    it('should include metadata for fixed strategy chunks', async () => {
      const content = 'A'.repeat(1500);
      const ctx = createMockContext();
      const { result } = await collectEvents(
        chunkTool.call(
          {
            content,
            strategy: 'fixed',
            options: { maxChunkSize: 500 },
          },
          ctx,
        ),
      );

      expect(result).not.toBeNull();
      expect(result!.chunks[0].metadata).toBeDefined();
      expect((result!.chunks[0].metadata as any).start).toBe(0);
      expect((result!.chunks[0].metadata as any).end).toBe(500);
    });

    it('should yield progress with chunk count', async () => {
      const content = 'A'.repeat(100) + '\n\n' + 'B'.repeat(200);
      const ctx = createMockContext();
      const { progress } = await collectEvents(
        chunkTool.call({ content }, ctx),
      );

      expect(progress).toHaveLength(1);
      expect(progress[0].message).toContain('chunks');
    });
  });

  describe('minChunkSize', () => {
    it('should merge small final chunk into previous one', async () => {
      // 600 + 50 = two chunks: 600 chars then 50 chars (below minChunkSize 200)
      const content = 'A'.repeat(600) + '\n\n' + 'B'.repeat(50);
      const ctx = createMockContext();
      const { result } = await collectEvents(
        chunkTool.call(
          {
            content,
            strategy: 'paragraph',
            options: { maxChunkSize: 800, minChunkSize: 200 },
          },
          ctx,
        ),
      );

      expect(result).not.toBeNull();
      expect(result!.chunks).toHaveLength(1);
      expect(result!.chunks[0].content).toBe(content);
    });

    it('should merge small middle chunk into previous one', async () => {
      // 500 chars + 30 chars + 500 chars
      // Without minChunkSize: chunk1(500), chunk2(30), chunk3(500)
      // With minChunkSize=200: chunk2(30) merged into chunk1 → chunk1(531), chunk3(500)
      const content =
        'A'.repeat(500) + '\n\n' + 'B'.repeat(30) + '\n\n' + 'C'.repeat(500);
      const ctx = createMockContext();
      const { result } = await collectEvents(
        chunkTool.call(
          {
            content,
            strategy: 'paragraph',
            options: { maxChunkSize: 600, minChunkSize: 200 },
          },
          ctx,
        ),
      );

      expect(result).not.toBeNull();
      expect(result!.chunks).toHaveLength(2);
      // The small middle chunk should be merged into the first chunk
      expect(result!.chunks[0].content).toContain('A'.repeat(500));
      expect(result!.chunks[0].content).toContain('B'.repeat(30));
      expect(result!.chunks[1].content).toContain('C'.repeat(500));
      // Verify indices are renumbered
      expect(result!.chunks[0].index).toBe(0);
      expect(result!.chunks[1].index).toBe(1);
    });

    it('should not merge chunks when all chunks meet minChunkSize', async () => {
      const content =
        'A'.repeat(300) + '\n\n' + 'B'.repeat(300) + '\n\n' + 'C'.repeat(300);
      const ctx = createMockContext();
      const { result } = await collectEvents(
        chunkTool.call(
          {
            content,
            strategy: 'paragraph',
            options: { maxChunkSize: 400, minChunkSize: 200 },
          },
          ctx,
        ),
      );

      expect(result).not.toBeNull();
      // Each paragraph is 300 chars (> minChunkSize 200), no merging needed
      expect(result!.chunks).toHaveLength(3);
    });

    it('should use default minChunkSize of 200 when not specified', async () => {
      // 1000 chars + 30 chars — the 30-char tail is below default minChunkSize
      const content = 'A'.repeat(1000) + '\n\n' + 'B'.repeat(30);
      const ctx = createMockContext();
      const { result } = await collectEvents(
        chunkTool.call(
          {
            content,
            strategy: 'paragraph',
            options: { maxChunkSize: 1200 },
          },
          ctx,
        ),
      );

      expect(result).not.toBeNull();
      expect(result!.chunks).toHaveLength(1);
    });

    it('should disable merging when minChunkSize is 0', async () => {
      // 400 + 380 + 30 → chunks: [400], [380], [30]
      // With minChunkSize=0, the 30-char chunk stays separate
      const content =
        'A'.repeat(400) + '\n\n' + 'B'.repeat(380) + '\n\n' + 'C'.repeat(30);
      const ctx = createMockContext();
      const { result } = await collectEvents(
        chunkTool.call(
          {
            content,
            strategy: 'paragraph',
            options: { maxChunkSize: 400, minChunkSize: 0 },
          },
          ctx,
        ),
      );

      expect(result).not.toBeNull();
      expect(result!.chunks).toHaveLength(3);
      expect(result!.chunks[0].content).toBe('A'.repeat(400));
      expect(result!.chunks[1].content).toBe('B'.repeat(380));
      expect(result!.chunks[2].content).toBe('C'.repeat(30));
    });

    it('should merge consecutive small chunks into previous large one', async () => {
      // 500 + 30 + 30 + 500
      // Both 30-char chunks merge into chunk1
      const content =
        'A'.repeat(500) +
        '\n\n' +
        'B'.repeat(30) +
        '\n\n' +
        'C'.repeat(30) +
        '\n\n' +
        'D'.repeat(500);
      const ctx = createMockContext();
      const { result } = await collectEvents(
        chunkTool.call(
          {
            content,
            strategy: 'paragraph',
            options: { maxChunkSize: 600, minChunkSize: 200 },
          },
          ctx,
        ),
      );

      expect(result).not.toBeNull();
      expect(result!.chunks).toHaveLength(2);
      expect(result!.chunks[0].content).toContain('A'.repeat(500));
      expect(result!.chunks[0].content).toContain('B'.repeat(30));
      expect(result!.chunks[0].content).toContain('C'.repeat(30));
      expect(result!.chunks[1].content).toContain('D'.repeat(500));
    });

    it('should keep first small chunk when it has no predecessor', async () => {
      // 30 + 400 + 400 → first chunk(30) has no predecessor to merge into
      const content =
        'A'.repeat(30) + '\n\n' + 'B'.repeat(400) + '\n\n' + 'C'.repeat(400);
      const ctx = createMockContext();
      const { result } = await collectEvents(
        chunkTool.call(
          {
            content,
            strategy: 'paragraph',
            options: { maxChunkSize: 400, minChunkSize: 200 },
          },
          ctx,
        ),
      );

      expect(result).not.toBeNull();
      // First chunk(30) is small but can't merge backward; rest stay separate
      expect(result!.chunks).toHaveLength(3);
      expect(result!.chunks[0].content).toBe('A'.repeat(30));
      expect(result!.chunks[1].content).toBe('B'.repeat(400));
      expect(result!.chunks[2].content).toBe('C'.repeat(400));
    });
  });
});
