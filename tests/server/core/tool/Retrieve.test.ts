import EmbedTool from '@/server/core/tool/Embed';
import RetrieveTool from '@/server/core/tool/Retrieve';
import type { RetrieveOutput } from '@/server/core/tool/Retrieve/config';
import logger from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import { AgentEvent } from '@/shared/types';
import { DatabaseService } from '@/server/service/DatabaseService';
import { container } from 'tsyringe';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
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
  generator: AsyncGenerator<AgentEvent, RetrieveOutput, void>,
): Promise<{
  progress: Array<{ message?: string }>;
  result: RetrieveOutput | null;
}> {
  const progress: Array<{ message?: string }> = [];
  let result: RetrieveOutput | null = null;

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

describe('RetrieveTool', () => {
  let retrieveTool: RetrieveTool;
  let mockDb: DatabaseService;
  let mockEmbedTool: EmbedTool;

  beforeEach(() => {
    vi.clearAllMocks();

    mockDb = {
      dataSource: {
        query: vi.fn().mockResolvedValue([
          {
            chunkId: 'chunk_1',
            content: 'Relevant content',
            distance: '0.2',
            documentId: 'doc_1',
            title: 'Test Document',
            category: 'tech_blog',
            sourceUrl: 'https://example.com',
          },
        ]),
      },
    } as unknown as DatabaseService;

    mockEmbedTool = {
      call: vi.fn().mockImplementation(async function* () {
        yield {
          type: 'result',
          callId: 'tc_1',
          toolName: ToolIds.EMBEDDING_GENERATE,
          output: {
            chunks: [
              { content: 'query', index: 0, embedding: [0.1, 0.2, 0.3] },
            ],
            model: 'test-model',
            dimension: 3,
          },
          seq: 1,
          at: Date.now(),
        };
        return {
          chunks: [{ content: 'query', index: 0, embedding: [0.1, 0.2, 0.3] }],
          model: 'test-model',
          dimension: 3,
        };
      }),
    } as unknown as EmbedTool;

    container.register(ToolIds.EMBEDDING_GENERATE, { useValue: mockEmbedTool });

    retrieveTool = new RetrieveTool(mockDb);
    (retrieveTool as any).logger = logger;
  });

  afterEach(() => {
    container.reset();
  });

  describe('call', () => {
    it('should retrieve relevant chunks for query', async () => {
      const ctx = createMockContext();
      const { progress, result } = await collectEvents(
        retrieveTool.call({ query: 'test query' }, ctx),
      );

      expect(progress).toHaveLength(3);
      expect(progress[0].message).toContain('Generating embedding');
      expect(progress[1].message).toContain('Searching vector database');
      expect(progress[2].message).toContain('Found 1 relevant chunks');

      expect(result).not.toBeNull();
      expect(result!.results).toHaveLength(1);
      expect(result!.results[0].chunkId).toBe('chunk_1');
      expect(result!.results[0].similarity).toBeCloseTo(0.8);
    });

    it('should respect limit parameter', async () => {
      const ctx = createMockContext();
      await collectEvents(retrieveTool.call({ query: 'test', limit: 5 }, ctx));

      expect(mockDb.dataSource.query).toHaveBeenCalledWith(expect.any(String), [
        expect.any(String),
        5,
      ]);
    });

    it('should filter results by threshold', async () => {
      mockDb = {
        dataSource: {
          query: vi.fn().mockResolvedValue([
            {
              chunkId: 'chunk_1',
              content: 'High similarity',
              distance: '0.1',
              documentId: 'doc_1',
              title: 'Doc 1',
              category: 'tech_blog',
              sourceUrl: null,
            },
            {
              chunkId: 'chunk_2',
              content: 'Low similarity',
              distance: '0.9',
              documentId: 'doc_2',
              title: 'Doc 2',
              category: 'other',
              sourceUrl: null,
            },
          ]),
        },
      } as unknown as DatabaseService;

      retrieveTool = new RetrieveTool(mockDb);
      (retrieveTool as any).logger = logger;

      const ctx = createMockContext();
      const { result } = await collectEvents(
        retrieveTool.call({ query: 'test', threshold: 0.8 }, ctx),
      );

      expect(result!.results).toHaveLength(1);
      expect(result!.results[0].chunkId).toBe('chunk_1');
    });

    it('should calculate similarity correctly', async () => {
      const ctx = createMockContext();
      const { result } = await collectEvents(
        retrieveTool.call({ query: 'test' }, ctx),
      );

      // distance 0.2 -> similarity 0.8
      expect(result!.results[0].similarity).toBeCloseTo(0.8);
    });

    it('should include document info in results', async () => {
      const ctx = createMockContext();
      const { result } = await collectEvents(
        retrieveTool.call({ query: 'test' }, ctx),
      );

      expect(result!.results[0].document.id).toBe('doc_1');
      expect(result!.results[0].document.title).toBe('Test Document');
      expect(result!.results[0].document.category).toBe('tech_blog');
    });

    it('should handle empty results', async () => {
      mockDb = {
        dataSource: {
          query: vi.fn().mockResolvedValue([]),
        },
      } as unknown as DatabaseService;

      retrieveTool = new RetrieveTool(mockDb);
      (retrieveTool as any).logger = logger;

      const ctx = createMockContext();
      const { result, progress } = await collectEvents(
        retrieveTool.call({ query: 'nonexistent' }, ctx),
      );

      expect(result!.results).toHaveLength(0);
      expect(progress[2].message).toContain('Found 0 relevant chunks');
    });

    it('should truncate long query in progress message', async () => {
      const longQuery = 'a'.repeat(100);
      const ctx = createMockContext();
      const { progress } = await collectEvents(
        retrieveTool.call({ query: longQuery }, ctx),
      );

      expect(progress[0].message).toContain('...');
      expect(progress[0].message!.length).toBeLessThan(150);
    });
  });
});
