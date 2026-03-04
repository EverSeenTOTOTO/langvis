import LlmCallTool from '@/server/core/tool/LlmCall';
import MetaExtractTool from '@/server/core/tool/MetaExtract';
import type { MetaExtractOutput } from '@/server/core/tool/MetaExtract/config';
import logger from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import { AgentEvent } from '@/shared/types';
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
  let mockLlmCallTool: LlmCallTool;

  beforeEach(() => {
    vi.clearAllMocks();

    mockLlmCallTool = {
      call: vi.fn().mockImplementation(async function* () {
        yield {
          type: 'result',
          callId: 'tc_1',
          toolName: ToolIds.LLM_CALL,
          output: JSON.stringify({
            title: 'Test Document Title',
            summary: 'A brief summary',
            keywords: ['test', 'document'],
            category: 'tech_blog',
            metadata: { platform: 'github' },
          }),
          seq: 1,
          at: Date.now(),
        };
        return JSON.stringify({
          title: 'Test Document Title',
          summary: 'A brief summary',
          keywords: ['test', 'document'],
          category: 'tech_blog',
          metadata: { platform: 'github' },
        });
      }),
    } as unknown as LlmCallTool;

    container.register(ToolIds.LLM_CALL, { useValue: mockLlmCallTool });

    metaExtractTool = new MetaExtractTool();
    (metaExtractTool as any).logger = logger;
  });

  afterEach(() => {
    container.reset();
  });

  describe('call', () => {
    it('should extract metadata from content', async () => {
      const content = 'This is a test document about technology.';
      const ctx = createMockContext();
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

      expect(mockLlmCallTool.call).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'user' }),
          ]),
        }),
        ctx,
      );
    });

    it('should truncate long content', async () => {
      const longContent = 'A'.repeat(10000);
      const ctx = createMockContext();
      await collectEvents(metaExtractTool.call({ content: longContent }, ctx));

      // Content should be truncated to 8000 chars in the prompt
      const callArgs = (mockLlmCallTool.call as any).mock.calls[0][0];
      const userMessage = callArgs.messages.find((m: any) => m.role === 'user');
      expect(userMessage.content.length).toBeLessThan(9000);
    });

    it('should provide defaults for missing fields', async () => {
      mockLlmCallTool = {
        call: vi.fn().mockImplementation(async function* () {
          yield {
            type: 'result',
            callId: 'tc_1',
            toolName: ToolIds.LLM_CALL,
            output: JSON.stringify({}),
            seq: 1,
            at: Date.now(),
          };
          return JSON.stringify({});
        }),
      } as unknown as LlmCallTool;

      container.register(ToolIds.LLM_CALL, { useValue: mockLlmCallTool });
      metaExtractTool = new MetaExtractTool();
      (metaExtractTool as any).logger = logger;

      const ctx = createMockContext();
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
      mockLlmCallTool = {
        call: vi.fn().mockImplementation(async function* () {
          yield {
            type: 'result',
            callId: 'tc_1',
            toolName: ToolIds.LLM_CALL,
            output: null,
            seq: 1,
            at: Date.now(),
          };
          return null;
        }),
      } as unknown as LlmCallTool;

      container.register(ToolIds.LLM_CALL, { useValue: mockLlmCallTool });
      metaExtractTool = new MetaExtractTool();
      (metaExtractTool as any).logger = logger;

      const ctx = createMockContext();
      await expect(
        collectEvents(metaExtractTool.call({ content: 'test' }, ctx)),
      ).rejects.toThrow('No response from LLM');
    });

    it('should throw error on invalid JSON response', async () => {
      mockLlmCallTool = {
        call: vi.fn().mockImplementation(async function* () {
          yield {
            type: 'result',
            callId: 'tc_1',
            toolName: ToolIds.LLM_CALL,
            output: 'not valid json',
            seq: 1,
            at: Date.now(),
          };
          return 'not valid json';
        }),
      } as unknown as LlmCallTool;

      container.register(ToolIds.LLM_CALL, { useValue: mockLlmCallTool });
      metaExtractTool = new MetaExtractTool();
      (metaExtractTool as any).logger = logger;

      const ctx = createMockContext();
      await expect(
        collectEvents(metaExtractTool.call({ content: 'test' }, ctx)),
      ).rejects.toThrow('Failed to parse LLM response as JSON');
    });

    it('should truncate summary to 50 chars', async () => {
      const longSummary = 'A'.repeat(100);
      mockLlmCallTool = {
        call: vi.fn().mockImplementation(async function* () {
          yield {
            type: 'result',
            callId: 'tc_1',
            toolName: ToolIds.LLM_CALL,
            output: JSON.stringify({ summary: longSummary }),
            seq: 1,
            at: Date.now(),
          };
          return JSON.stringify({ summary: longSummary });
        }),
      } as unknown as LlmCallTool;

      container.register(ToolIds.LLM_CALL, { useValue: mockLlmCallTool });
      metaExtractTool = new MetaExtractTool();
      (metaExtractTool as any).logger = logger;

      const ctx = createMockContext();
      const { result } = await collectEvents(
        metaExtractTool.call({ content: 'test' }, ctx),
      );

      expect(result!.summary.length).toBe(50);
    });

    it('should include keyword count in progress', async () => {
      const ctx = createMockContext();
      const { progress } = await collectEvents(
        metaExtractTool.call({ content: 'test' }, ctx),
      );

      const lastProgress = progress[1] as { data?: { keywordCount?: number } };
      expect(lastProgress.data?.keywordCount).toBe(2);
    });
  });
});
