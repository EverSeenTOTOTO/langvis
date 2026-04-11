import { beforeEach, describe, expect, it, vi } from 'vitest';
import { container } from 'tsyringe';
import ListToolsTool from '@/server/core/tool/ListTools';
import { AgentEvent } from '@/shared/types';
import { TraceContext } from '@/server/core/TraceContext';
import { ExecutionContext } from '@/server/core/ExecutionContext';

const mockToolService = {
  getAllToolInfo: vi.fn(),
};

const mockSkillService = {
  getAllSkillInfo: vi.fn().mockResolvedValue([]),
};

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

function createMockTool(
  id: string,
  name: string,
  description: string,
  inputSchema?: any,
) {
  return {
    id,
    config: { name, description, inputSchema, outputSchema: undefined },
  } as any;
}

describe('ListToolsTool', () => {
  let toolInstance: ListToolsTool;
  let resolveSpy: any;

  const sampleTools = [
    {
      id: 'ask_user',
      name: 'ask_user',
      description: 'Ask the user a question',
    },
    {
      id: 'cached_read',
      name: 'cached_read',
      description: 'Read cached content',
    },
    { id: 'agent_call', name: 'agent_call', description: 'Call a sub-agent' },
    {
      id: 'list_tools',
      name: 'list_tools',
      description: 'List available tools',
    },
    {
      id: 'file_edit',
      name: 'file_edit',
      description: 'Edit a file in the workspace',
    },
    { id: 'bash', name: 'bash', description: 'Execute a bash command' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();

    resolveSpy = vi
      .spyOn(container, 'resolve' as any)
      .mockImplementation((token: any) => {
        if (
          typeof token === 'string' &&
          sampleTools.find(t => t.id === token)
        ) {
          const t = sampleTools.find(s => s.id === token)!;
          return createMockTool(t.id, t.name, t.description);
        }
        return originalResolve(token);
      });

    mockToolService.getAllToolInfo.mockResolvedValue(sampleTools);

    toolInstance = new ListToolsTool(
      mockToolService as any,
      mockSkillService as any,
    );
    (toolInstance as any).id = 'list_tools';
    (toolInstance as any).config = {};
    (toolInstance as any).logger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };
  });

  afterEach(() => {
    resolveSpy.mockRestore();
  });

  it('should return non-core tools without query', () =>
    wrapTrace(async () => {
      const ctx = new ExecutionContext(new AbortController(), 'test-msg');
      const { result } = await collectEvents(toolInstance.call({}, ctx));

      expect(result.tools).toContain('### file_edit');
      expect(result.tools).toContain('### bash');
      expect(result.tools).not.toContain('### ask_user');
      expect(result.tools).not.toContain('### cached_read');
      expect(result.tools).not.toContain('### agent_call');
      expect(result.tools).not.toContain('### list_tools');
    }));

  it('should filter by single query keyword', () =>
    wrapTrace(async () => {
      const ctx = new ExecutionContext(new AbortController(), 'test-msg');
      const { result } = await collectEvents(
        toolInstance.call({ query: 'file' }, ctx),
      );

      expect(result.tools).toContain('### file_edit');
      expect(result.tools).not.toContain('### bash');
    }));

  it('should filter by multiple space-separated keywords (any match)', () =>
    wrapTrace(async () => {
      const ctx = new ExecutionContext(new AbortController(), 'test-msg');
      const { result } = await collectEvents(
        toolInstance.call({ query: 'file workspace' }, ctx),
      );

      expect(result.tools).toContain('### file_edit');
      expect(result.tools).not.toContain('### bash');
    }));

  it('should return no tools message when no non-core tools exist', () =>
    wrapTrace(async () => {
      mockToolService.getAllToolInfo.mockResolvedValue([
        { id: 'ask_user', name: 'ask_user', description: 'Ask' },
      ]);
      const ctx = new ExecutionContext(new AbortController(), 'test-msg');
      const { result } = await collectEvents(toolInstance.call({}, ctx));

      expect(result.tools).toBe('No tools available.');
    }));
});
