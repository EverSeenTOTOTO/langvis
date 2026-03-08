import MetaExtractTool from '@/server/core/tool/MetaExtract';
import type { MetaExtractOutput } from '@/server/core/tool/MetaExtract/config';
import logger from '@/server/utils/logger';
import { AgentEvent } from '@/shared/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockContext } from '../../helpers/context';

async function collectEvents(
  generator: AsyncGenerator<AgentEvent, MetaExtractOutput, void>,
): Promise<{
  progress: Array<{ message?: string }>;
  result: MetaExtractOutput | null;
}> {
  const progress: Array<{ message?: string }> = [];
  let result: MetaExtractOutput | null = null;

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

describe('MetaExtractTool', () => {
  let metaExtractTool: MetaExtractTool;

  beforeEach(() => {
    vi.clearAllMocks();

    metaExtractTool = new MetaExtractTool();
    (metaExtractTool as any).logger = logger;
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe('call', () => {
    it('should extract metadata from content', async () => {
      const content = 'This is a test document about technology.';
      const ctx = createMockContext();

      // Mock callLlm to return content
      vi.spyOn(ctx, 'callLlm').mockImplementation(async function* () {
        yield { type: 'stream', content: 'test', seq: 1, at: Date.now() };
        return JSON.stringify({
          title: 'Test Document Title',
          summary: 'A brief summary',
          keywords: ['test', 'document'],
          category: 'tech_blog',
          metadata: { platform: 'github' },
        });
      });

      const { progress, result } = await collectEvents(
        metaExtractTool.call({ content }, ctx),
      );

      expect(progress).toHaveLength(2);
      expect(progress[0].message).toContain('Analyzing document content');
      expect(progress[1].message).toContain('Test Document Title');
      expect(progress[1].message).toContain('tech_blog');

      expect(result).not.toBeNull();
      expect(result!.title).toBe('Test Document Title');
      expect(result!.summary).toBe('A brief summary');
      expect(result!.keywords).toEqual(['test', 'document']);
      expect(result!.category).toBe('tech_blog');
    });

    it('should include sourceUrl and sourceType in prompt', async () => {
      const content = 'Document content';
      const ctx = createMockContext();

      const callLlmSpy = vi
        .spyOn(ctx, 'callLlm')
        .mockImplementation(async function* () {
          yield { type: 'stream', content: 'test', seq: 1, at: Date.now() };
          return JSON.stringify({ title: 'Test' });
        });

      await collectEvents(
        metaExtractTool.call(
          {
            content,
            sourceUrl: 'https://example.com/article',
            sourceType: 'web',
          },
          ctx,
        ),
      );

      // First arg is options, second is ignoreProgress flag
      expect(callLlmSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'user' }),
          ]),
        }),
      );
    });

    it('should truncate long content', async () => {
      const longContent = 'A'.repeat(10000);
      const ctx = createMockContext();

      const callLlmSpy = vi
        .spyOn(ctx, 'callLlm')
        .mockImplementation(async function* () {
          yield { type: 'stream', content: 'test', seq: 1, at: Date.now() };
          return JSON.stringify({ title: 'Test' });
        });

      await collectEvents(metaExtractTool.call({ content: longContent }, ctx));

      // Content should be truncated to 8000 chars in the prompt
      const callArgs = callLlmSpy.mock.calls[0][0];
      const userMessage = callArgs.messages!.find(
        (m: any) => m.role === 'user',
      );
      expect(userMessage!.content!.length).toBeLessThan(9000);
    });

    it('should provide defaults for missing fields', async () => {
      const ctx = createMockContext();

      vi.spyOn(ctx, 'callLlm').mockImplementation(async function* () {
        yield { type: 'stream', content: '{}', seq: 1, at: Date.now() };
        return JSON.stringify({});
      });

      const { result } = await collectEvents(
        metaExtractTool.call({ content: 'test' }, ctx),
      );

      expect(result!.title).toBe('Untitled');
      expect(result!.summary).toBe('');
      expect(result!.keywords).toEqual([]);
      expect(result!.category).toBe('other');
      expect(result!.metadata).toEqual({});
    });

    it('should throw error on empty LLM response', async () => {
      const ctx = createMockContext();

      vi.spyOn(ctx, 'callLlm').mockImplementation(async function* () {
        return '';
      });

      await expect(
        collectEvents(metaExtractTool.call({ content: 'test' }, ctx)),
      ).rejects.toThrow('No response from LLM');
    });

    it('should throw error on invalid JSON response', async () => {
      const ctx = createMockContext();

      vi.spyOn(ctx, 'callLlm').mockImplementation(async function* () {
        return 'not valid json';
      });

      await expect(
        collectEvents(metaExtractTool.call({ content: 'test' }, ctx)),
      ).rejects.toThrow('Failed to parse LLM response as JSON');
    });

    it('should truncate summary to 50 chars', async () => {
      const longSummary = 'A'.repeat(100);
      const ctx = createMockContext();

      vi.spyOn(ctx, 'callLlm').mockImplementation(async function* () {
        return JSON.stringify({ summary: longSummary });
      });

      const { result } = await collectEvents(
        metaExtractTool.call({ content: 'test' }, ctx),
      );

      expect(result!.summary.length).toBe(50);
    });

    it('should include keyword count in progress', async () => {
      const ctx = createMockContext();

      vi.spyOn(ctx, 'callLlm').mockImplementation(async function* () {
        yield { type: 'stream', content: 'test', seq: 1, at: Date.now() };
        return JSON.stringify({
          title: 'Test',
          summary: 'Summary',
          keywords: ['test', 'document'],
          category: 'tech_blog',
        });
      });

      const { progress } = await collectEvents(
        metaExtractTool.call({ content: 'test' }, ctx),
      );

      const lastProgress = progress[1] as { data?: { keywordCount?: number } };
      expect(lastProgress.data?.keywordCount).toBe(2);
    });
  });
});
