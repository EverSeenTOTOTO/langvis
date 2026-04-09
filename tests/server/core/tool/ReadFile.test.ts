import { promises as fs } from 'fs';
import path from 'path';
import { beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import ReadFileTool from '@/server/core/tool/ReadFile';
import { AgentEvent } from '@/shared/types';
import { TraceContext } from '@/server/core/TraceContext';
import { ExecutionContext } from '@/server/core/ExecutionContext';

const mockWorkspaceService = {
  getWorkDir: vi.fn(),
  readFile: vi.fn(),
};

function wrapTrace<T>(fn: () => Promise<T>): Promise<T> {
  return TraceContext.run(
    {
      requestId: 'test-req',
      conversationId: 'test-conv',
      messageId: 'test-msg',
    },
    fn,
  );
}

async function collectEvents<T>(
  generator: AsyncGenerator<AgentEvent, T, void>,
): Promise<{ events: AgentEvent[]; result: T }> {
  const events: AgentEvent[] = [];
  let result: T;
  while (true) {
    const { done, value } = await generator.next();
    if (done) {
      result = value as T;
      break;
    }
    events.push(value);
  }
  return { events, result };
}

describe('ReadFileTool', () => {
  let tool: ReadFileTool;
  let testDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    tool = new ReadFileTool(mockWorkspaceService as any);
    (tool as any).id = 'file_read';
    (tool as any).config = {};
    (tool as any).logger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };

    testDir = path.join('/tmp', `langvis-test-readfile-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
    mockWorkspaceService.getWorkDir.mockResolvedValue(testDir);
  });

  afterAll(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('should read existing file', () =>
    wrapTrace(async () => {
      await fs.writeFile(path.join(testDir, 'hello.txt'), 'hello world');

      mockWorkspaceService.readFile.mockImplementation(
        async (filename: string, dir: string) => {
          const filePath = path.join(dir, filename);
          const content = await fs.readFile(filePath, 'utf-8');
          return { content, size: content.length };
        },
      );

      const ctx = new ExecutionContext(new AbortController(), 'test-msg');
      const { result } = await collectEvents(
        tool.call({ path: 'hello.txt' }, ctx),
      );

      expect(result.content).toBe('hello world');
      expect(result.size).toBe(11);
      expect(result.path).toBe('hello.txt');
    }));

  it('should throw for non-existing file', () =>
    wrapTrace(async () => {
      mockWorkspaceService.readFile.mockResolvedValue(null);

      const ctx = new ExecutionContext(new AbortController(), 'test-msg');
      await expect(
        collectEvents(tool.call({ path: 'missing.txt' }, ctx)),
      ).rejects.toThrow('File not found');
    }));
});
