import { AsyncLocalStorage } from 'async_hooks';
import { container } from 'tsyringe';
import { ExecutionContext } from '@/server/core/ExecutionContext';
import { TraceContext } from '@/server/core/TraceContext';
import type { TraceStore } from '@/server/core/TraceContext';
import { RedisService } from '@/server/service/RedisService';

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
): ExecutionContext {
  let ctx: ExecutionContext | undefined;
  TraceContext.run({ requestId: 'test-req', traceId, conversationId }, () => {
    ctx = new ExecutionContext(new AbortController());
  });
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
): T {
  const als = ensureAls();
  return als.run({ requestId: 'test-req', traceId, conversationId }, fn);
}
