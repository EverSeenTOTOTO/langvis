import EmbedTool from '@/server/core/tool/Embed';
import type { LlmService } from '@/server/service/LlmService';
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

function createMockLlmService(): LlmService {
  return {
    embed: vi.fn(),
  } as unknown as LlmService;
}

describe('EmbedTool', () => {
  let embedTool: EmbedTool;
  let mockLlmService: LlmService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLlmService = createMockLlmService();
    embedTool = new EmbedTool(mockLlmService);
    (embedTool as any).logger = logger;
  });

  describe('call', () => {
    it('should generate embeddings for chunks', async () => {
      const mockEmbedding = [0.1, 0.2, 0.3];
      vi.mocked(mockLlmService.embed).mockResolvedValue([
        { embedding: mockEmbedding },
      ]);

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
      vi.mocked(mockLlmService.embed).mockResolvedValue([
        { embedding: mockEmbedding },
      ]);

      const chunks = [{ content: 'Test', index: 0 }];
      const ctx = createMockContext();
      const { result } = await collectEvents(
        embedTool.call({ chunks, model: 'custom-model' }, ctx),
      );

      expect(result!.model).toBe('custom-model');
      expect(mockLlmService.embed).toHaveBeenCalledWith(
        'custom-model',
        ['Test'],
        expect.any(AbortSignal),
      );
    });

    it('should handle multiple chunks and maintain order', async () => {
      const embeddings = [
        { embedding: [0.1, 0.2] },
        { embedding: [0.3, 0.4] },
        { embedding: [0.5, 0.6] },
      ];
      vi.mocked(mockLlmService.embed).mockResolvedValue(embeddings);

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

    it('should handle API failure from LlmService', async () => {
      vi.mocked(mockLlmService.embed).mockRejectedValue(
        new Error('Embedding API failed: 500 - Internal Server Error'),
      );

      const chunks = [{ content: 'Test', index: 0 }];
      const ctx = createMockContext();

      await expect(
        collectEvents(embedTool.call({ chunks }, ctx)),
      ).rejects.toThrow('Embedding API failed: 500');
    });

    it('should pass abort signal to LlmService', async () => {
      vi.mocked(mockLlmService.embed).mockResolvedValue([{ embedding: [0.1] }]);

      const chunks = [{ content: 'Test', index: 0 }];
      const ctx = createMockContext();
      await collectEvents(embedTool.call({ chunks, model: 'test-model' }, ctx));

      expect(mockLlmService.embed).toHaveBeenCalledWith(
        'test-model',
        ['Test'],
        expect.anything(),
      );
    });
  });
});
