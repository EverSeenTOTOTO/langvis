import BatchArchiveTool from '@/server/core/tool/BatchArchive';
import logger from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import { container } from 'tsyringe';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockContext } from '../../helpers/context';

// Mock tools
const mockWebFetchCall = vi.fn();
const mockAnalysisCall = vi.fn();

vi.mock('@/server/core/tool/WebFetch', () => ({
  default: class MockWebFetchTool {
    async *call(input: unknown) {
      return yield* mockWebFetchCall(input);
    }
  },
}));

vi.mock('@/server/core/tool/Analysis', () => ({
  default: class MockAnalysisTool {
    async *call(input: unknown) {
      return yield* mockAnalysisCall(input);
    }
  },
}));

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

async function getResult<T>(gen: AsyncGenerator<unknown, T, void>): Promise<T> {
  const events: unknown[] = [];
  let result = await gen.next();
  while (!result.done) {
    events.push(result.value);
    result = await gen.next();
  }
  return { ...result.value, events } as T & { events: unknown[] };
}

describe('BatchArchiveTool', () => {
  let tool: BatchArchiveTool;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset container and register mock tools
    container.reset();
    container.register(ToolIds.WEB_FETCH, {
      useValue: {
        async *call(input: unknown) {
          return yield* mockWebFetchCall(input);
        },
      },
    });
    container.register(ToolIds.DOCUMENT_ARCHIVE, {
      useValue: {
        async *call(input: unknown) {
          return yield* mockAnalysisCall(input);
        },
      },
    });

    tool = new BatchArchiveTool();
    // @ts-expect-error readonly
    tool.id = ToolIds.DOCUMENT_ARCHIVE_BATCH;
    // @ts-expect-error readonly
    tool.config = {
      name: 'Batch Archive Tool',
      description: 'Test tool',
    };
    (tool as any).logger = logger;
  });

  describe('successful archiving', () => {
    it('should archive multiple URLs sequentially', async () => {
      mockWebFetchCall.mockImplementation(function* (input: { url: string }) {
        return {
          title: `Title for ${input.url}`,
          textContent: `Content for ${input.url}`,
        };
      });

      mockAnalysisCall.mockImplementation(function* (input: {
        content: string;
      }) {
        return {
          documentId: `doc-${input.content}`,
          title: 'Test Title',
          category: 'tech_blog',
          chunkCount: 5,
        };
      });

      const ctx = createMockContext();
      const result = await getResult(
        tool.call(
          {
            urls: [
              'https://example.com/article1',
              'https://example.com/article2',
            ],
          },
          ctx,
        ),
      );

      expect(result.total).toBe(2);
      expect(result.succeeded).toBe(2);
      expect(result.failed).toBe(0);
      expect(result.results).toHaveLength(2);
      expect(result.results[0].status).toBe('success');
      expect(result.results[1].status).toBe('success');
    });

    it('should yield progress events for each URL', async () => {
      mockWebFetchCall.mockImplementation(function* () {
        return { title: 'Test', textContent: 'Content' };
      });

      mockAnalysisCall.mockImplementation(function* () {
        return {
          documentId: 'doc-1',
          title: 'Test',
          category: 'tech_blog',
          chunkCount: 5,
        };
      });

      const ctx = createMockContext();
      const result = await getResult(
        tool.call(
          {
            urls: [
              'https://example.com/article1',
              'https://example.com/article2',
            ],
          },
          ctx,
        ),
      );

      // Each URL yields: processing, success (2 events per URL)
      // Plus the final result
      expect((result as any).events.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('error handling', () => {
    it('should continue archiving other URLs when one fails', async () => {
      mockWebFetchCall.mockImplementationOnce(function* () {
        throw new Error('Network error');
      });

      mockWebFetchCall.mockImplementation(function* () {
        return { title: 'Success', textContent: 'Content' };
      });

      mockAnalysisCall.mockImplementation(function* () {
        return {
          documentId: 'doc-1',
          title: 'Test',
          category: 'tech_blog',
          chunkCount: 5,
        };
      });

      const ctx = createMockContext();
      const result = await getResult(
        tool.call(
          {
            urls: ['https://example.com/fail', 'https://example.com/success'],
          },
          ctx,
        ),
      );

      expect(result.total).toBe(2);
      expect(result.succeeded).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.results[0].status).toBe('failed');
      expect(result.results[0].error).toBe('Network error');
      expect(result.results[1].status).toBe('success');
    });

    it('should report all URLs as failed when all fail', async () => {
      mockWebFetchCall.mockImplementation(function* () {
        throw new Error('Connection refused');
      });

      const ctx = createMockContext();
      const result = await getResult(
        tool.call(
          {
            urls: ['https://example.com/fail1', 'https://example.com/fail2'],
          },
          ctx,
        ),
      );

      expect(result.total).toBe(2);
      expect(result.succeeded).toBe(0);
      expect(result.failed).toBe(2);
      expect(result.results.every(r => r.status === 'failed')).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle empty URL list', async () => {
      const ctx = createMockContext();
      const result = await getResult(tool.call({ urls: [] }, ctx));

      expect(result.total).toBe(0);
      expect(result.succeeded).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.results).toHaveLength(0);
    });

    it('should handle single URL', async () => {
      mockWebFetchCall.mockImplementation(function* () {
        return { title: 'Single', textContent: 'Content' };
      });

      mockAnalysisCall.mockImplementation(function* () {
        return {
          documentId: 'doc-1',
          title: 'Single',
          category: 'tech_blog',
          chunkCount: 3,
        };
      });

      const ctx = createMockContext();
      const result = await getResult(
        tool.call({ urls: ['https://example.com/single'] }, ctx),
      );

      expect(result.total).toBe(1);
      expect(result.succeeded).toBe(1);
      expect(result.results).toHaveLength(1);
    });
  });

  describe('timeout handling', () => {
    it('should pass timeout to AnalysisTool', async () => {
      mockWebFetchCall.mockImplementation(function* () {
        return { title: 'Test', textContent: 'Content' };
      });

      mockAnalysisCall.mockImplementation(function* () {
        return {
          documentId: 'doc-1',
          title: 'Test',
          category: 'tech_blog',
          chunkCount: 5,
        };
      });

      const ctx = createMockContext();
      const result = await getResult(
        tool.call(
          {
            urls: ['https://example.com/test'],
            timeout: 60000,
          },
          ctx,
        ),
      );

      expect(result.total).toBe(1);
      expect(result.succeeded).toBe(1);
      // Verify timeout was passed to AnalysisTool
      expect(mockAnalysisCall).toHaveBeenCalled();
      const callArgs = mockAnalysisCall.mock.calls[0];
      expect(callArgs[0]).toMatchObject({ timeout: 60000 });
    });

    it('should use default timeout when not specified', async () => {
      mockWebFetchCall.mockImplementation(function* () {
        return { title: 'Test', textContent: 'Content' };
      });

      mockAnalysisCall.mockImplementation(function* () {
        return {
          documentId: 'doc-1',
          title: 'Test',
          category: 'tech_blog',
          chunkCount: 5,
        };
      });

      const ctx = createMockContext();
      const result = await getResult(
        tool.call({ urls: ['https://example.com/test'] }, ctx),
      );

      expect(result.total).toBe(1);
      expect(result.succeeded).toBe(1);
      // Default timeout should be passed
      expect(mockAnalysisCall).toHaveBeenCalled();
      const callArgs = mockAnalysisCall.mock.calls[0];
      expect(callArgs[0]).toMatchObject({ timeout: 120000 });
    });
  });
});
