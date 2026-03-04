import ChunkTool from '@/server/core/tool/Chunk';
import type { ChunkOutput } from '@/server/core/tool/Chunk/config';
import logger from '@/server/utils/logger';
import { ToolEvent } from '@/shared/types';
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
  generator: AsyncGenerator<ToolEvent, ChunkOutput, void>,
): Promise<{
  progress: Array<{ message?: string; data?: unknown }>;
  result: ChunkOutput | null;
}> {
  const progress: Array<{ message?: string; data?: unknown }> = [];
  let result: ChunkOutput | null = null;
  for await (const event of generator) {
    if (event.type === 'progress') {
      progress.push(event.data as { message?: string; data?: unknown });
    } else if (event.type === 'result') {
      result = event.output as ChunkOutput;
    }
  }
  return { progress, result };
}

describe('ChunkTool', () => {
  let chunkTool: ChunkTool;

  beforeEach(() => {
    vi.clearAllMocks();
    chunkTool = new ChunkTool();
    (chunkTool as any).logger = logger;
  });

  describe('call', () => {
    it('should chunk content using paragraph strategy by default', async () => {
      // Note: Paragraph strategy merges small paragraphs into larger chunks
      // up to maxChunkSize. For testing separate chunks, we need long content.
      const content =
        'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.';
      const ctx = createMockContext();
      const { progress, result } = await collectEvents(
        chunkTool.call({ content }, ctx),
      );

      expect(progress).toHaveLength(1);
      // Paragraph strategy merges small paragraphs, so we get 1 chunk
      expect(progress[0].message).toContain('1 chunks');

      expect(result).not.toBeNull();
      // Content is small enough to be merged into one chunk
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
      // Long paragraphs should be split
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
      ).rejects.toThrow('Unknown chunk strategy: unknown');
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
});
