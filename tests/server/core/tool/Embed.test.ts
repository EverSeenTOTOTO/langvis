import EmbedTool from '@/server/core/tool/Embed';
import type { EmbedOutput } from '@/server/core/tool/Embed/config';
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

const originalEnv = process.env;

async function collectEvents(
  generator: AsyncGenerator<AgentEvent, EmbedOutput, void>,
): Promise<{
  progress: Array<{ message?: string }>;
  result: EmbedOutput | null;
}> {
  const progress: Array<{ message?: string }> = [];
  let result: EmbedOutput | null = null;

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

describe('EmbedTool', () => {
  let embedTool: EmbedTool;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env = { ...originalEnv };
    embedTool = new EmbedTool();
    (embedTool as any).logger = logger;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('call', () => {
    it('should generate embeddings for chunks', async () => {
      const mockEmbedding = [0.1, 0.2, 0.3];
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [{ embedding: mockEmbedding, index: 0 }],
        }),
      });

      process.env.OPENAI_API_BASE = 'https://api.test.com';
      process.env.OPENAI_API_KEY = 'test-key';

      const chunks = [{ content: 'Test content', index: 0 }];
      const ctx = createMockContext();
      const { progress, result } = await collectEvents(
        embedTool.call({ chunks }, ctx),
      );

      expect(progress).toHaveLength(1);
      expect(progress[0].message).toContain('embedding API');
      expect(progress[0].message).toContain('1 texts');

      expect(result).not.toBeNull();
      expect(result!.chunks).toHaveLength(1);
      expect(result!.chunks[0].embedding).toEqual(mockEmbedding);
      expect(result!.dimension).toBe(3);
    });

    it('should use custom model when specified', async () => {
      const mockEmbedding = [0.1, 0.2];
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [{ embedding: mockEmbedding, index: 0 }],
        }),
      });

      process.env.OPENAI_API_BASE = 'https://api.test.com';
      process.env.OPENAI_API_KEY = 'test-key';

      const chunks = [{ content: 'Test', index: 0 }];
      const ctx = createMockContext();
      const { result } = await collectEvents(
        embedTool.call({ chunks, model: 'custom-model' }, ctx),
      );

      expect(result!.model).toBe('custom-model');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.test.com/embeddings',
        expect.objectContaining({
          body: expect.stringContaining('custom-model'),
        }),
      );
    });

    it('should handle multiple chunks and maintain order', async () => {
      const embeddings = [
        { embedding: [0.1, 0.2], index: 0 },
        { embedding: [0.3, 0.4], index: 1 },
        { embedding: [0.5, 0.6], index: 2 },
      ];
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: embeddings }),
      });

      process.env.OPENAI_API_BASE = 'https://api.test.com';
      process.env.OPENAI_API_KEY = 'test-key';

      const chunks = [
        { content: 'First', index: 0 },
        { content: 'Second', index: 1 },
        { content: 'Third', index: 2 },
      ];
      const ctx = createMockContext();
      const { progress, result } = await collectEvents(
        embedTool.call({ chunks }, ctx),
      );

      expect(progress[0].message).toContain('3 texts');

      expect(result!.chunks[0].embedding).toEqual([0.1, 0.2]);
      expect(result!.chunks[1].embedding).toEqual([0.3, 0.4]);
      expect(result!.chunks[2].embedding).toEqual([0.5, 0.6]);
    });

    it('should throw error when API env vars not configured', async () => {
      delete process.env.OPENAI_API_BASE;
      delete process.env.OPENAI_API_KEY;

      const chunks = [{ content: 'Test', index: 0 }];
      const ctx = createMockContext();

      await expect(
        collectEvents(embedTool.call({ chunks }, ctx)),
      ).rejects.toThrow(
        'OPENAI_API_BASE and OPENAI_API_KEY must be configured',
      );
    });

    it('should throw error on API failure', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      process.env.OPENAI_API_BASE = 'https://api.test.com';
      process.env.OPENAI_API_KEY = 'test-key';

      const chunks = [{ content: 'Test', index: 0 }];
      const ctx = createMockContext();

      await expect(
        collectEvents(embedTool.call({ chunks }, ctx)),
      ).rejects.toThrow('Embedding API failed: 500');
    });

    it('should pass abort signal to fetch', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [{ embedding: [0.1], index: 0 }],
        }),
      });
      global.fetch = mockFetch;

      process.env.OPENAI_API_BASE = 'https://api.test.com';
      process.env.OPENAI_API_KEY = 'test-key';

      const chunks = [{ content: 'Test', index: 0 }];
      const ctx = createMockContext();
      await collectEvents(embedTool.call({ chunks }, ctx));

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          signal: ctx.signal,
        }),
      );
    });
  });
});
