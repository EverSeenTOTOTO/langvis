import { container } from 'tsyringe';
import { ExecutionContext } from '@/server/core/ExecutionContext';
import { InjectTokens } from '@/shared/constants';

const mockRedis = {
  setEx: () => Promise.resolve('OK'),
  get: () => Promise.resolve(null),
  del: () => Promise.resolve(1),
} as any;

// Register mock redis if not already registered
try {
  container.resolve(InjectTokens.REDIS);
} catch {
  container.register(InjectTokens.REDIS, { useValue: mockRedis });
}

export function createMockContext(traceId = 'test-trace-id'): ExecutionContext {
  return new ExecutionContext(traceId, new AbortController());
}
