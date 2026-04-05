import { AsyncLocalStorage } from 'async_hooks';
import { container } from 'tsyringe';
import { ExecutionContext } from '@/server/core/ExecutionContext';
import { TraceContext } from '@/server/core/TraceContext';
import type { TraceStore } from '@/server/core/TraceContext';
import { RedisService } from '@/server/service/RedisService';
import { AgentEvent } from '@/shared/types';

const mockRedisService = {
  get: () => Promise.resolve(null),
  set: () => Promise.resolve(),
  del: () => Promise.resolve(),
  client: {
    setEx: () => Promise.resolve('OK'),
    get: () => Promise.resolve(null),
    del: () => Promise.resolve(1),
  },
} as unknown as RedisService;

// Register mock RedisService if not already registered
try {
  container.resolve(RedisService);
} catch {
  if (typeof container.register === 'function') {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    container.register(RedisService, { useValue: mockRedisService });
  }
}

export function createMockContext(
  traceId = 'test-trace-id',
  conversationId = 'test-conversation',
  messageId = 'test-message',
): ExecutionContext {
  let ctx: ExecutionContext | undefined;
  TraceContext.run(
    { requestId: 'test-req', traceId, conversationId, messageId },
    () => {
      ctx = new ExecutionContext(new AbortController(), messageId);
    },
  );
  return ctx!;
}

// Patch TraceContext's internal als to ensure it's usable
// This is needed because vi.mock can cause module re-evaluation
function ensureAls(): AsyncLocalStorage<TraceStore> {
  if (!(TraceContext as any).als) {
    (TraceContext as any).als = new AsyncLocalStorage<TraceStore>();
  }
  return (TraceContext as any).als;
}

export function withTraceContext<T>(
  fn: () => T,
  traceId = 'test-trace-id',
  conversationId = 'test-conversation',
  messageId = 'test-message',
): T {
  const als = ensureAls();
  return als.run(
    { requestId: 'test-req', traceId, conversationId, messageId },
    fn,
  );
}

// Helper to create agent events with messageId
export function createEvent(
  type: 'start',
  messageId: string,
  seq?: number,
): { type: 'start'; messageId: string; seq: number; at: number };
export function createEvent(
  type: 'stream',
  messageId: string,
  content: string,
  seq?: number,
): {
  type: 'stream';
  messageId: string;
  content: string;
  seq: number;
  at: number;
};
export function createEvent(
  type: 'thought',
  messageId: string,
  content: string,
  seq?: number,
): {
  type: 'thought';
  messageId: string;
  content: string;
  seq: number;
  at: number;
};
export function createEvent(
  type: 'final',
  messageId: string,
  seq?: number,
): { type: 'final'; messageId: string; seq: number; at: number };
export function createEvent(
  type: 'cancelled',
  messageId: string,
  reason: string,
  seq?: number,
): {
  type: 'cancelled';
  messageId: string;
  reason: string;
  seq: number;
  at: number;
};
export function createEvent(
  type: 'error',
  messageId: string,
  error: string,
  seq?: number,
): { type: 'error'; messageId: string; error: string; seq: number; at: number };
export function createEvent(
  type: 'tool_call',
  messageId: string,
  callId: string,
  toolName: string,
  toolArgs: Record<string, unknown>,
  seq?: number,
): {
  type: 'tool_call';
  messageId: string;
  callId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  seq: number;
  at: number;
};
export function createEvent(
  type: 'tool_result',
  messageId: string,
  callId: string,
  toolName: string,
  output: unknown,
  seq?: number,
): {
  type: 'tool_result';
  messageId: string;
  callId: string;
  toolName: string;
  output: unknown;
  seq: number;
  at: number;
};
export function createEvent(
  type: 'tool_progress',
  messageId: string,
  callId: string,
  toolName: string,
  data: unknown,
  seq?: number,
): {
  type: 'tool_progress';
  messageId: string;
  callId: string;
  toolName: string;
  data: unknown;
  seq: number;
  at: number;
};
export function createEvent(
  type: string,
  messageId: string,
  ...args: unknown[]
): AgentEvent {
  const seq = (args[args.length - 1] as number) ?? Date.now();
  const at = Date.now();

  switch (type) {
    case 'start':
      return { type: 'start', messageId, seq, at };
    case 'stream':
      return { type: 'stream', messageId, content: args[1] as string, seq, at };
    case 'thought':
      return {
        type: 'thought',
        messageId,
        content: args[1] as string,
        seq,
        at,
      };
    case 'final':
      return { type: 'final', messageId, seq, at };
    case 'cancelled':
      return {
        type: 'cancelled',
        messageId,
        reason: args[1] as string,
        seq,
        at,
      };
    case 'error':
      return { type: 'error', messageId, error: args[1] as string, seq, at };
    case 'tool_call':
      return {
        type: 'tool_call',
        messageId,
        callId: args[1] as string,
        toolName: args[2] as string,
        toolArgs: args[3] as Record<string, unknown>,
        seq,
        at,
      };
    case 'tool_result':
      return {
        type: 'tool_result',
        messageId,
        callId: args[1] as string,
        toolName: args[2] as string,
        output: args[3],
        seq,
        at,
      };
    case 'tool_progress':
      return {
        type: 'tool_progress',
        messageId,
        callId: args[1] as string,
        toolName: args[2] as string,
        data: args[3],
        seq,
        at,
      };
    default:
      throw new Error(`Unknown event type: ${type}`);
  }
}
