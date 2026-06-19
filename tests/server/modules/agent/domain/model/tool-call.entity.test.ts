import { describe, it, expect, vi } from 'vitest';
import { ToolCall } from '@/server/modules/agent/domain/model/tool-call.entity';
import type { Tool } from '@/server/modules/agent/domain/model/tool.base';
import type { CachePort } from '@/server/modules/agent/domain/port/cache.port';
import type { LlmPort } from '@/server/modules/agent/domain/port/llm.port';
import type { ToolCallEmitter } from '@/server/modules/agent/domain/model/tool-call.entity';

function makeMockTool(config?: {
  untrustedOutput?: boolean;
  compression?: 'skip' | 'file';
}): Tool {
  return {
    id: 'mock-tool',
    config: config ?? {},
    call: vi.fn().mockImplementation(function* () {
      return 'tool output';
    }),
  } as unknown as Tool;
}

function makeMockCache(): CachePort {
  return {
    resolve: vi.fn(async (_id: string, value: unknown) => value),
    compress: vi.fn(async (_id: string, value: unknown) => value),
    readFile: vi.fn(),
  };
}

function makeMockLlm(): LlmPort {
  return {
    chat: vi.fn(),
    chatContent: vi.fn(),
    embed: vi.fn(),
    tts: vi.fn(),
    stt: vi.fn(),
  } as unknown as LlmPort;
}

function makeMockEmitter(): ToolCallEmitter {
  return {
    emitToolCall: vi.fn((callId, toolName, toolArgs) => ({
      type: 'tool_call' as const,
      callId,
      toolName,
      toolArgs,
      runId: 'run_1',
      seq: 1,
      at: Date.now(),
    })),
    emitToolProgress: vi.fn((callId, data) => ({
      type: 'tool_progress' as const,
      callId,
      data,
      runId: 'run_1',
      seq: 2,
      at: Date.now(),
    })),
    emitToolResult: vi.fn((callId, toolName, output) => ({
      type: 'tool_result' as const,
      callId,
      toolName,
      output,
      runId: 'run_1',
      seq: 3,
      at: Date.now(),
    })),
    emitToolError: vi.fn((callId, toolName, error) => ({
      type: 'tool_error' as const,
      callId,
      toolName,
      error,
      runId: 'run_1',
      seq: 3,
      at: Date.now(),
    })),
  };
}

function createToolCall(tool?: Tool): ToolCall {
  return new ToolCall(
    'tc_1',
    tool ?? makeMockTool(),
    { input: 'test' },
    makeMockCache(),
    new AbortController().signal,
    '/tmp/work',
    'msg_1',
    'run_1',
    makeMockLlm(),
  );
}

describe('ToolCall', () => {
  describe('execute', () => {
    it('should resolve input args from cache first', async () => {
      const cache = makeMockCache();
      const toolCall = new ToolCall(
        'tc_1',
        makeMockTool(),
        { input: 'test' },
        cache,
        new AbortController().signal,
        '/tmp',
        'msg_1',
        'run_1',
        makeMockLlm(),
      );

      const emitter = makeMockEmitter();
      const gen = toolCall.execute(emitter);
      for await (const _ of gen) {
        /* consume generator */
      }

      expect(cache.resolve).toHaveBeenCalledWith('run_1', { input: 'test' });
    });

    it('should emit tool_call event with resolved input', async () => {
      const toolCall = createToolCall();
      const emitter = makeMockEmitter();

      const gen = toolCall.execute(emitter);
      const events: any[] = [];
      for await (const event of gen) {
        events.push(event);
      }

      expect(emitter.emitToolCall).toHaveBeenCalledWith(
        'tc_1',
        'mock-tool',
        expect.anything(),
      );
    });

    it('should emit tool_result on successful execution', async () => {
      const cache = makeMockCache();
      const toolCall = new ToolCall(
        'tc_1',
        makeMockTool(),
        { input: 'test' },
        cache,
        new AbortController().signal,
        '/tmp',
        'msg_1',
        'run_1',
        makeMockLlm(),
      );
      const emitter = makeMockEmitter();

      const gen = toolCall.execute(emitter);
      for await (const _ of gen) {
        /* consume generator */
      }

      expect(emitter.emitToolResult).toHaveBeenCalledWith(
        'tc_1',
        'mock-tool',
        expect.anything(),
      );
      expect(toolCall.status).toBe('completed');
    });

    it('should emit tool_error on tool exception', async () => {
      const failingTool: Tool = {
        id: 'fail-tool',
        config: {},
        call: vi.fn().mockImplementation(function* () {
          throw new Error('Tool crashed');
        }),
      } as unknown as Tool;

      const toolCall = new ToolCall(
        'tc_fail',
        failingTool,
        {},
        makeMockCache(),
        new AbortController().signal,
        '/tmp',
        'msg_1',
        'run_1',
        makeMockLlm(),
      );
      const emitter = makeMockEmitter();

      const gen = toolCall.execute(emitter);
      for await (const _ of gen) {
        /* consume generator */
      }

      expect(emitter.emitToolError).toHaveBeenCalledWith(
        'tc_fail',
        'fail-tool',
        'Tool crashed',
      );
      expect(toolCall.status).toBe('failed');
    });
  });

  describe('observation', () => {
    it('should return raw output for trusted tools', () => {
      const toolCall = createToolCall(makeMockTool({ untrustedOutput: false }));
      // Manually complete to test observation
      (toolCall as any).complete('raw output');

      expect(toolCall.observation).toBe('raw output');
    });

    it('should wrap output in untrusted_content tags for untrusted tools', () => {
      const toolCall = createToolCall(makeMockTool({ untrustedOutput: true }));
      (toolCall as any).complete('external content');

      expect(toolCall.observation).toContain('<untrusted_content>');
      expect(toolCall.observation).toContain('external content');
      expect(toolCall.observation).toContain('</untrusted_content>');
    });

    it('should return error message for failed status', () => {
      const toolCall = createToolCall();
      (toolCall as any).fail('something went wrong');

      expect(toolCall.observation).toContain('Error executing tool');
      expect(toolCall.observation).toContain('something went wrong');
    });

    it('should stringify non-string output', () => {
      const toolCall = createToolCall();
      (toolCall as any).complete({ key: 'value' });

      expect(toolCall.observation).toBe(JSON.stringify({ key: 'value' }));
    });
  });

  describe('status transitions', () => {
    it('should start in pending status', () => {
      const toolCall = createToolCall();
      expect(toolCall.status).toBe('pending');
    });

    it('should transition to completed', () => {
      const toolCall = createToolCall();
      (toolCall as any).complete('output');
      expect(toolCall.status).toBe('completed');
    });

    it('should transition to failed', () => {
      const toolCall = createToolCall();
      (toolCall as any).fail('error');
      expect(toolCall.status).toBe('failed');
    });
  });

  describe('toRecord', () => {
    it('should produce a ToolCallRecord snapshot', () => {
      const toolCall = createToolCall();
      (toolCall as any).complete('output');

      const record = toolCall.toRecord();
      expect(record.callId).toBe('tc_1');
      expect(record.toolName).toBe('mock-tool');
      expect(record.status).toBe('completed');
      expect(record.duration).toBeGreaterThanOrEqual(0);
      expect(record.startedAt).toBeGreaterThan(0);
      expect(record.completedAt).toBeGreaterThan(0);
    });
  });
});
