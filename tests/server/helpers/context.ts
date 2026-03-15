import { container } from 'tsyringe';
import { ExecutionContext } from '@/server/core/ExecutionContext';
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
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  container.register(RedisService, { useValue: mockRedisService });
}

export function createMockContext(traceId = 'test-trace-id'): ExecutionContext {
  return new ExecutionContext(traceId, new AbortController());
}
