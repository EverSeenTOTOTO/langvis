import { ExecutionContext } from '@/server/core/ExecutionContext';

export function createMockContext(traceId = 'test-trace-id'): ExecutionContext {
  return new ExecutionContext(traceId, new AbortController());
}
