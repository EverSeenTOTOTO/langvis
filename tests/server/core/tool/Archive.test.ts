import ArchiveTool from '@/server/core/tool/Archive';
import type { ArchiveOutput } from '@/server/core/tool/Archive/config';
import logger from '@/server/utils/logger';
import { AgentEvent } from '@/shared/types';
import { DataSource } from 'typeorm';
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
  generator: AsyncGenerator<AgentEvent, ArchiveOutput, void>,
): Promise<{
  progress: Array<{ message?: string }>;
  result: ArchiveOutput | null;
}> {
  const progress: Array<{ message?: string }> = [];
  let result: ArchiveOutput | null = null;

  while (true) {
    const { done, value } = await generator.next();
    if (done) {
      result = value ?? null;
      break;
    }
    if (value.type === 'tool_progress') {
      progress.push(value.data as { message?: string });
    }
  }
  return { progress, result };
}

describe('ArchiveTool', () => {
  let archiveTool: ArchiveTool;
  let mockDataSource: DataSource;
  let mockManager: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockManager = {
      create: vi
        .fn()
        .mockImplementation((_entity, data) => ({ ...data, id: 'doc_123' })),
      save: vi.fn().mockResolvedValue(undefined),
    };

    mockDataSource = {
      transaction: vi.fn().mockImplementation(async fn => {
        return fn(mockManager);
      }),
    } as unknown as DataSource;

    archiveTool = new ArchiveTool(mockDataSource);
    (archiveTool as any).logger = logger;
  });

  describe('call', () => {
    it('should save document and chunks to database', async () => {
      const input = {
        document: {
          title: 'Test Document',
          summary: 'Test summary',
          keywords: ['test', 'document'],
          category: 'tech_blog' as const,
          metadata: { platform: 'github' },
          sourceUrl: 'https://example.com',
          sourceType: 'web' as const,
          rawContent: 'Full content here',
        },
        chunks: [
          { content: 'Chunk 1', index: 0, embedding: [0.1, 0.2] },
          { content: 'Chunk 2', index: 1, embedding: [0.3, 0.4] },
        ],
      };

      const ctx = createMockContext();
      const { progress, result } = await collectEvents(
        archiveTool.call(input, ctx),
      );

      expect(progress).toHaveLength(2);
      expect(progress[0].message).toContain('Saving document');
      expect(progress[0].message).toContain('Test Document');
      expect(progress[1].message).toContain('saved with 2 chunks');

      expect(result).not.toBeNull();
      expect(result!.documentId).toBe('doc_123');
      expect(result!.chunkCount).toBe(2);

      // create called for doc + chunks, save called twice (doc + batch chunks)
      expect(mockManager.create).toHaveBeenCalledTimes(3);
      expect(mockManager.save).toHaveBeenCalledTimes(2);
    });

    it('should include progress data with document info', async () => {
      const input = {
        document: {
          title: 'My Title',
          summary: 'Summary',
          keywords: [],
          category: 'other' as const,
          metadata: {},
          sourceType: 'text' as const,
          rawContent: 'Content',
        },
        chunks: [{ content: 'Chunk', index: 0, embedding: [] }],
      };

      const ctx = createMockContext();
      const { progress } = await collectEvents(archiveTool.call(input, ctx));

      const firstProgress = progress[0] as {
        data?: { title?: string; chunkCount?: number };
      };
      expect(firstProgress.data?.title).toBe('My Title');
      expect(firstProgress.data?.chunkCount).toBe(1);
    });

    it('should handle empty chunks array', async () => {
      const input = {
        document: {
          title: 'Empty Doc',
          summary: '',
          keywords: [],
          category: 'other' as const,
          metadata: {},
          sourceType: 'text' as const,
          rawContent: '',
        },
        chunks: [],
      };

      const ctx = createMockContext();
      const { result } = await collectEvents(archiveTool.call(input, ctx));

      expect(result!.chunkCount).toBe(0);
    });

    it('should preserve chunk metadata', async () => {
      const input = {
        document: {
          title: 'Test',
          summary: '',
          keywords: [],
          category: 'other' as const,
          metadata: {},
          sourceType: 'text' as const,
          rawContent: '',
        },
        chunks: [
          {
            content: 'Chunk with metadata',
            index: 0,
            embedding: [0.1],
            metadata: { custom: 'value' },
          },
        ],
      };

      const ctx = createMockContext();
      await collectEvents(archiveTool.call(input, ctx));

      expect(mockManager.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          metadata: { custom: 'value' },
        }),
      );
    });
  });
});
