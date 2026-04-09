import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { container } from 'tsyringe';
import BashTool from '@/server/core/tool/Bash';
import { WorkspaceService } from '@/server/service/WorkspaceService';
import { ToolIds } from '@/shared/constants';
import { AgentEvent } from '@/shared/types';
import { TraceContext } from '@/server/core/TraceContext';
import { ExecutionContext } from '@/server/core/ExecutionContext';
import type { ChildProcess } from 'child_process';

const mockWorkspaceService = {
  getWorkDir: vi.fn().mockResolvedValue('/tmp/workspace'),
};

const mockHitl = { call: vi.fn() };

const originalResolve = container.resolve.bind(container);

let mockSpawn: ReturnType<typeof vi.fn>;

function createMockChild(pid = 12345): {
  child: ChildProcess;
  emit: (event: string, ...args: any[]) => void;
} {
  const handlers: Record<string, ((...args: any[]) => void)[]> = {};
  const streams = {
    on: vi.fn((_event: string, fn: (...args: any[]) => void) => {
      if (!handlers[_event]) handlers[_event] = [];
      handlers[_event].push(fn);
    }),
    removeAllListeners: vi.fn(),
    destroy: vi.fn(),
  };
  const child: any = {
    pid,
    stdout: streams,
    stderr: streams,
    stdin: streams,
    exitCode: null as number | null,
    killed: false,
    on: (event: string, fn: (...args: any[]) => void) => {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(fn);
      return child;
    },
    kill: vi.fn((sig?: string) => {
      if (sig === 'SIGKILL') {
        child.killed = true;
        child.exitCode = -9;
        (handlers['close'] || []).forEach(fn => fn(-9));
      }
    }),
  };

  return {
    child: child as unknown as ChildProcess,
    emit: (event: string, ...args: any[]) => {
      (handlers[event] || []).forEach(fn => fn(...args));
    },
  };
}

vi.mock('child_process', () => ({
  spawn: (...args: any[]) => mockSpawn(...args),
}));

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

describe('BashTool', () => {
  let tool: BashTool;
  let resolveSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSpawn = vi.fn();
    resolveSpy = vi
      .spyOn(container, 'resolve' as any)
      .mockImplementation((token: any) => {
        if (token === ToolIds.ASK_USER) return mockHitl;
        if (token === WorkspaceService) return mockWorkspaceService;
        return originalResolve(token);
      });
  });

  afterEach(() => {
    resolveSpy.mockRestore();
  });

  it('should execute command after user confirms', () =>
    wrapTrace(async () => {
      tool = new BashTool(mockWorkspaceService as any);
      (tool as any).id = 'bash';
      (tool as any).config = {};
      (tool as any).logger = {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      };

      const ctx = new ExecutionContext(new AbortController(), 'test-msg');

      mockHitl.call.mockImplementation(async function* () {
        return { submitted: true, data: { confirmed: true, timeout: 10 } };
      });

      const mock = createMockChild();
      mockSpawn.mockReturnValue(mock.child);
      setTimeout(() => mock.emit('close', 0), 50);

      const { result } = await collectEvents(
        tool.call({ command: 'echo hello', timeout: 10 }, ctx),
      );

      expect(result.exitCode).toBe(0);
      expect(result.stderr).not.toContain('timed out');
    }));

  it('should throw when user cancels', () =>
    wrapTrace(async () => {
      tool = new BashTool(mockWorkspaceService as any);
      (tool as any).id = 'bash';
      (tool as any).config = {};
      (tool as any).logger = {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      };

      const ctx = new ExecutionContext(new AbortController(), 'test-msg');

      mockHitl.call.mockImplementation(async function* () {
        return {
          submitted: true,
          data: { confirmed: false, remark: '太危险了' },
        };
      });

      await expect(
        collectEvents(tool.call({ command: 'rm -rf /' }, ctx)),
      ).rejects.toThrow('太危险了');
    }));

  it('should throw with default message when user cancels without remark', () =>
    wrapTrace(async () => {
      tool = new BashTool(mockWorkspaceService as any);
      (tool as any).id = 'bash';
      (tool as any).config = {};
      (tool as any).logger = {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      };

      const ctx = new ExecutionContext(new AbortController(), 'test-msg');

      mockHitl.call.mockImplementation(async function* () {
        return { submitted: true, data: { confirmed: false } };
      });

      await expect(
        collectEvents(tool.call({ command: 'rm -rf /' }, ctx)),
      ).rejects.toThrow('用户取消了命令执行');
    }));

  it('should spawn with shell:true, detached:true, TERM:dumb', () =>
    wrapTrace(async () => {
      tool = new BashTool(mockWorkspaceService as any);
      (tool as any).id = 'bash';
      (tool as any).config = {};
      (tool as any).logger = {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      };

      const ctx = new ExecutionContext(new AbortController(), 'test-msg');

      mockHitl.call.mockImplementation(async function* () {
        return { submitted: true, data: { confirmed: true, timeout: 5 } };
      });

      const mock = createMockChild();
      mockSpawn.mockReturnValue(mock.child);
      setTimeout(() => mock.emit('close', 0), 10);

      await collectEvents(tool.call({ command: 'ls' }, ctx));

      expect(mockSpawn).toHaveBeenCalledWith(
        'ls',
        expect.objectContaining({
          shell: true,
          detached: true,
          cwd: '/tmp/workspace',
        }),
      );

      const env = mockSpawn.mock.calls[0][1].env;
      expect(env.TERM).toBe('dumb');
    }));

  it(
    'should report timedOut when timeout fires',
    () =>
      wrapTrace(async () => {
        tool = new BashTool(mockWorkspaceService as any);
        (tool as any).id = 'bash';
        (tool as any).config = {};
        (tool as any).logger = {
          info: vi.fn(),
          error: vi.fn(),
          warn: vi.fn(),
          debug: vi.fn(),
        };

        const ctx = new ExecutionContext(new AbortController(), 'test-msg');

        mockHitl.call.mockImplementation(async function* () {
          return { submitted: true, data: { confirmed: true, timeout: 1 } };
        });

        const mock = createMockChild();
        mockSpawn.mockReturnValue(mock.child);
        setTimeout(() => mock.emit('close', null), 1500);

        const { result } = await collectEvents(
          tool.call({ command: 'sleep 100' }, ctx),
        );

        expect(result.timedOut).toBe(true);
        expect(result.stderr).toContain('timed out');
      }),
    5000,
  );
});
