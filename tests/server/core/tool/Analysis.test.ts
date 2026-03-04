import AnalysisTool from '@/server/core/tool/Analysis';
import type { AnalysisOutput } from '@/server/core/tool/Analysis/config';
import ArchiveTool from '@/server/core/tool/Archive';
import ChunkTool from '@/server/core/tool/Chunk';
import EmbedTool from '@/server/core/tool/Embed';
import MetaExtractTool from '@/server/core/tool/MetaExtract';
import logger from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import { ToolEvent } from '@/shared/types';
import { container } from 'tsyringe';
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
  generator: AsyncGenerator<ToolEvent, AnalysisOutput, void>,
): Promise<{
  progress: Array<{ action?: string; message?: string; toolName?: string }>;
  result: AnalysisOutput | null;
}> {
  const progress: Array<{
    action?: string;
    message?: string;
    toolName?: string;
  }> = [];
  let result: AnalysisOutput | null = null;
  for await (const event of generator) {
    if (event.type === 'progress') {
      progress.push(
        event.data as { action?: string; message?: string; toolName?: string },
      );
    } else if (event.type === 'result') {
      result = event.output as AnalysisOutput;
    }
  }
  return { progress, result };
}

describe('AnalysisTool', () => {
  let analysisTool: AnalysisTool;
  let mockMetaExtractTool: MetaExtractTool;
  let mockChunkTool: ChunkTool;
  let mockEmbedTool: EmbedTool;
  let mockArchiveTool: ArchiveTool;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock MetaExtractTool
    mockMetaExtractTool = {
      call: vi.fn().mockImplementation(async function* () {
        yield {
          type: 'result',
          callId: 'tc_meta',
          toolName: ToolIds.META_EXTRACT,
          output: {
            title: 'Extracted Title',
            summary: 'Summary',
            keywords: ['test'],
            category: 'tech_blog',
            metadata: {},
          },
          seq: 1,
          at: Date.now(),
        };
        return {
          title: 'Extracted Title',
          summary: 'Summary',
          keywords: ['test'],
          category: 'tech_blog',
          metadata: {},
        };
      }),
    } as unknown as MetaExtractTool;

    // Mock ChunkTool
    mockChunkTool = {
      call: vi.fn().mockImplementation(async function* () {
        yield {
          type: 'progress',
          callId: 'tc_chunk',
          toolName: ToolIds.CHUNK,
          data: { message: 'Split into 2 chunks' },
          seq: 2,
          at: Date.now(),
        };
        yield {
          type: 'result',
          callId: 'tc_chunk',
          toolName: ToolIds.CHUNK,
          output: {
            chunks: [
              { content: 'Chunk 1', index: 0 },
              { content: 'Chunk 2', index: 1 },
            ],
          },
          seq: 3,
          at: Date.now(),
        };
        return {
          chunks: [
            { content: 'Chunk 1', index: 0 },
            { content: 'Chunk 2', index: 1 },
          ],
        };
      }),
    } as unknown as ChunkTool;

    // Mock EmbedTool
    mockEmbedTool = {
      call: vi.fn().mockImplementation(async function* () {
        yield {
          type: 'progress',
          callId: 'tc_embed',
          toolName: ToolIds.EMBED,
          data: { message: 'Calling embedding API' },
          seq: 4,
          at: Date.now(),
        };
        yield {
          type: 'result',
          callId: 'tc_embed',
          toolName: ToolIds.EMBED,
          output: {
            chunks: [
              { content: 'Chunk 1', index: 0, embedding: [0.1, 0.2] },
              { content: 'Chunk 2', index: 1, embedding: [0.3, 0.4] },
            ],
            model: 'test-model',
            dimension: 2,
          },
          seq: 5,
          at: Date.now(),
        };
        return {
          chunks: [
            { content: 'Chunk 1', index: 0, embedding: [0.1, 0.2] },
            { content: 'Chunk 2', index: 1, embedding: [0.3, 0.4] },
          ],
          model: 'test-model',
          dimension: 2,
        };
      }),
    } as unknown as EmbedTool;

    // Mock ArchiveTool
    mockArchiveTool = {
      call: vi.fn().mockImplementation(async function* () {
        yield {
          type: 'progress',
          callId: 'tc_archive',
          toolName: ToolIds.ARCHIVE,
          data: { message: 'Saving document' },
          seq: 6,
          at: Date.now(),
        };
        yield {
          type: 'result',
          callId: 'tc_archive',
          toolName: ToolIds.ARCHIVE,
          output: {
            documentId: 'doc_123',
            chunkCount: 2,
          },
          seq: 7,
          at: Date.now(),
        };
        return {
          documentId: 'doc_123',
          chunkCount: 2,
        };
      }),
    } as unknown as ArchiveTool;

    container.register(ToolIds.META_EXTRACT, { useValue: mockMetaExtractTool });
    container.register(ToolIds.CHUNK, { useValue: mockChunkTool });
    container.register(ToolIds.EMBED, { useValue: mockEmbedTool });
    container.register(ToolIds.ARCHIVE, { useValue: mockArchiveTool });

    analysisTool = new AnalysisTool();
    (analysisTool as any).logger = logger;
  });

  afterEach(() => {
    container.reset();
  });

  describe('call', () => {
    it('should execute the full pipeline and yield progress events', async () => {
      const input = {
        content: 'Test document content for analysis.',
        sourceType: 'web' as const,
      };

      const ctx = createMockContext();
      const { progress, result } = await collectEvents(
        analysisTool.call(input, ctx),
      );

      // Filter to only AnalysisTool progress events (those with 'action' field)
      const analysisProgress = progress.filter(p => p.action !== undefined);

      expect(analysisProgress).toHaveLength(4);
      expect(analysisProgress[0].action).toBe('meta_extract');
      expect(analysisProgress[0].message).toContain(
        'Extracting document metadata',
      );
      expect(analysisProgress[1].action).toBe('chunk');
      expect(analysisProgress[1].message).toContain('Chunking content');
      expect(analysisProgress[2].action).toBe('embed');
      expect(analysisProgress[2].message).toContain('Calling embedding API');
      expect(analysisProgress[3].action).toBe('archive');
      expect(analysisProgress[3].message).toContain('Saving document');

      expect(result).not.toBeNull();
      expect(result!.documentId).toBe('doc_123');
      expect(result!.title).toBe('Extracted Title');
      expect(result!.category).toBe('tech_blog');
      expect(result!.chunkCount).toBe(2);
    });

    it('should call MetaExtractTool with correct params', async () => {
      const input = {
        content: 'Test content',
        sourceUrl: 'https://example.com',
        sourceType: 'web' as const,
      };

      const ctx = createMockContext();
      await collectEvents(analysisTool.call(input, ctx));

      expect(mockMetaExtractTool.call).toHaveBeenCalledWith(
        {
          content: 'Test content',
          sourceUrl: 'https://example.com',
          sourceType: 'web',
        },
        ctx,
      );
    });

    it('should call ChunkTool with paragraph strategy', async () => {
      const ctx = createMockContext();
      await collectEvents(
        analysisTool.call({ content: 'Test', sourceType: 'text' }, ctx),
      );

      expect(mockChunkTool.call).toHaveBeenCalledWith(
        expect.objectContaining({
          strategy: 'paragraph',
          options: { maxChunkSize: 1000 },
        }),
        ctx,
      );
    });

    it('should call EmbedTool with chunked content', async () => {
      const ctx = createMockContext();
      await collectEvents(
        analysisTool.call({ content: 'Test', sourceType: 'text' }, ctx),
      );

      expect(mockEmbedTool.call).toHaveBeenCalledWith(
        expect.objectContaining({
          chunks: expect.arrayContaining([
            expect.objectContaining({ content: 'Chunk 1' }),
          ]),
        }),
        ctx,
      );
    });

    it('should call ArchiveTool with combined data', async () => {
      const ctx = createMockContext();
      await collectEvents(
        analysisTool.call(
          {
            content: 'Test',
            sourceType: 'file',
            metadata: { custom: 'value' },
          },
          ctx,
        ),
      );

      expect(mockArchiveTool.call).toHaveBeenCalledWith(
        expect.objectContaining({
          document: expect.objectContaining({
            title: 'Extracted Title',
            category: 'tech_blog',
            sourceType: 'file',
            metadata: expect.objectContaining({ custom: 'value' }),
          }),
          chunks: expect.arrayContaining([
            expect.objectContaining({ embedding: expect.any(Array) }),
          ]),
        }),
        ctx,
      );
    });

    it('should include content size in chunk progress message', async () => {
      const largeContent = 'A'.repeat(5000);
      const ctx = createMockContext();
      const { progress } = await collectEvents(
        analysisTool.call({ content: largeContent, sourceType: 'text' }, ctx),
      );

      const chunkProgress = progress.find(p => p.action === 'chunk');
      expect(chunkProgress?.message).toContain('KB');
    });
  });
});
