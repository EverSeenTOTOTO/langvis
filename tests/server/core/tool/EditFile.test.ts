import { beforeEach, describe, expect, it, vi } from 'vitest';
import { container } from 'tsyringe';
import { ToolIds } from '@/shared/constants';
import { AgentEvent } from '@/shared/types';
import { TraceContext } from '@/server/core/TraceContext';
import { ExecutionContext } from '@/server/core/ExecutionContext';
import EditFileTool from '@/server/core/tool/EditFile';

const mockWorkspaceService = {
  getWorkDir: vi.fn().mockResolvedValue('/tmp/workspace'),
  editFile: vi.fn(),
};

const mockHitl = { call: vi.fn() };

const originalResolve = container.resolve.bind(container);

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

describe('EditFileTool', () => {
  let tool: EditFileTool;
  let resolveSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    resolveSpy = vi
      .spyOn(container, 'resolve' as any)
      .mockImplementation((token: any) => {
        if (token === ToolIds.ASK_USER) return mockHitl;
        return originalResolve(token);
      });

    tool = new EditFileTool(mockWorkspaceService as any);
    (tool as any).id = 'file_edit';
    (tool as any).config = {};
    (tool as any).logger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };
  });

  afterEach(() => {
    resolveSpy.mockRestore();
  });

  it('should edit file after user confirms', () =>
    wrapTrace(async () => {
      mockHitl.call.mockImplementation(async function* () {
        return { submitted: true, data: { confirmed: true } };
      });
      mockWorkspaceService.editFile.mockResolvedValue({ changes: 1 });

      const ctx = new ExecutionContext(new AbortController(), 'test-msg');
      const { result } = await collectEvents(
        tool.call(
          { path: 'test.txt', old_string: 'old', new_string: 'new' },
          ctx,
        ),
      );

      expect(result.path).toBe('test.txt');
      expect(result.changes).toBe(1);
      expect(mockWorkspaceService.editFile).toHaveBeenCalledWith(
        'test.txt',
        'old',
        'new',
        '/tmp/workspace',
      );
    }));

  it('should throw when user cancels', () =>
    wrapTrace(async () => {
      mockHitl.call.mockImplementation(async function* () {
        return { submitted: true, data: { confirmed: false } };
      });

      const ctx = new ExecutionContext(new AbortController(), 'test-msg');
      await expect(
        collectEvents(
          tool.call(
            { path: 'test.txt', old_string: 'old', new_string: 'new' },
            ctx,
          ),
        ),
      ).rejects.toThrow('操作已取消');
    }));

  it('should throw when form not submitted', () =>
    wrapTrace(async () => {
      mockHitl.call.mockImplementation(async function* () {
        return { submitted: false };
      });

      const ctx = new ExecutionContext(new AbortController(), 'test-msg');
      await expect(
        collectEvents(
          tool.call(
            { path: 'test.txt', old_string: 'old', new_string: 'new' },
            ctx,
          ),
        ),
      ).rejects.toThrow('操作已取消');
    }));
});
