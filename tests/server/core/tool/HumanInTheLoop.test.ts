import HumanInTheLoopTool from '@/server/core/tool/HumanInTheLoop';
import { ExecutionContext } from '@/server/core/ExecutionContext';
import { TraceContext } from '@/server/core/TraceContext';
import { RedisKeys, ToolIds } from '@/shared/constants';
import { JSONSchemaType } from 'ajv';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockContext } from '../../helpers/context';

function createMockRedisService(
  subscriberNotify?: (channel: string, message: string) => void,
) {
  const store = new Map<string, string>();
  const messageCallbacks = new Set<
    (channel: string, message: string) => void
  >();

  return {
    get: vi.fn((key: string) => {
      const data = store.get(key) ?? null;
      if (!data) return Promise.resolve(null);
      try {
        return Promise.resolve(JSON.parse(data));
      } catch {
        return Promise.resolve(data);
      }
    }),
    set: vi.fn((key: string, value: unknown) => {
      const serialized =
        typeof value === 'string' ? value : JSON.stringify(value);
      store.set(key, serialized);
      return Promise.resolve();
    }),
    del: vi.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
    client: {
      get: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
      set: vi.fn((key: string, value: string) => {
        store.set(key, value);
        return Promise.resolve('OK');
      }),
      del: vi.fn((key: string) => {
        store.delete(key);
        return Promise.resolve(1);
      }),
      publish: vi.fn((channel: string, message: string) => {
        subscriberNotify?.(channel, message);
        return Promise.resolve(1);
      }),
    },
    subscriber: {
      subscribe: vi.fn(
        (_channel: string, callback: (message: string) => void) => {
          const wrapper = (_: string, message: string) => callback(message);
          messageCallbacks.add(wrapper);
          return Promise.resolve();
        },
      ),
      unsubscribe: vi.fn(() => Promise.resolve()),
      _notify: (channel: string, message: string) => {
        messageCallbacks.forEach(cb => cb(channel, message));
      },
    },
    _store: store,
  };
}

async function collectEvents<T>(
  generator: AsyncGenerator<unknown, T, void>,
): Promise<{ events: unknown[]; result: T }> {
  const events: unknown[] = [];
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

const booleanSchema = {
  type: 'object',
  properties: { confirmed: { type: 'boolean' } },
} as unknown as JSONSchemaType<unknown>;
const objectSchemaWithName = {
  type: 'object',
  properties: { name: { type: 'string' } },
} as unknown as JSONSchemaType<unknown>;
const objectSchemaWithAnswer = {
  type: 'object',
  properties: { answer: { type: 'string' } },
} as unknown as JSONSchemaType<unknown>;
const objectSchemaWithEmail = {
  type: 'object',
  properties: { email: { type: 'string' } },
} as unknown as JSONSchemaType<unknown>;

describe('HumanInTheLoopTool', () => {
  let mockRedisService: ReturnType<typeof createMockRedisService>;
  let tool: HumanInTheLoopTool;

  beforeEach(() => {
    mockRedisService = createMockRedisService((channel, message) =>
      mockRedisService.subscriber._notify(channel, message),
    );
    tool = new HumanInTheLoopTool(mockRedisService as any);
    (tool as any).id = ToolIds.ASK_USER;
    (tool as any).config = {};
    (tool as any).logger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    };
  });

  describe('basic properties', () => {
    it('should have correct tool id', () => {
      expect(tool.id).toBe(ToolIds.ASK_USER);
    });
  });

  describe('call - successful submission', () => {
    it('should create Redis entry with correct data', async () => {
      await TraceContext.run(
        { requestId: 'test-req', conversationId: 'test-conversation' },
        async () => {
          const ctx = createMockContext();

          const generator = tool.call(
            {
              message: 'Please enter your name',
              formSchema: objectSchemaWithName,
              timeout: 100,
            },
            ctx,
          );

          const firstEvent = await generator.next();
          expect(firstEvent.done).toBe(false);
          expect(firstEvent.value).toMatchObject({
            type: 'tool_progress',
            toolName: ToolIds.ASK_USER,
            data: {
              status: 'awaiting_input',
              conversationId: 'test-conversation',
              message: 'Please enter your name',
              schema: objectSchemaWithName,
            },
          });

          expect(mockRedisService.set).toHaveBeenCalledWith(
            RedisKeys.HUMAN_INPUT('test-conversation'),
            expect.objectContaining({ submitted: false }),
          );

          await generator.return?.({ submitted: true });
        },
      );
    });

    it('should yield tool_progress event with awaiting_input status', async () => {
      await TraceContext.run(
        { requestId: 'test-req', conversationId: 'test-conversation' },
        async () => {
          const ctx = createMockContext();

          const generator = tool.call(
            {
              message: 'Confirm?',
              formSchema: booleanSchema,
              timeout: 50,
            },
            ctx,
          );

          const { value } = await generator.next();
          expect(value).toMatchObject({
            type: 'tool_progress',
            toolName: ToolIds.ASK_USER,
            data: {
              status: 'awaiting_input',
            },
          });
        },
      );
    });

    it('should return submitted result when user submits data via Pub/Sub', async () => {
      await TraceContext.run(
        { requestId: 'test-req', conversationId: 'test-conversation' },
        async () => {
          const ctx = createMockContext();

          const generator = tool.call(
            {
              message: 'Question?',
              formSchema: objectSchemaWithAnswer,
              timeout: 200,
            },
            ctx,
          );

          await generator.next();

          // Simulate submission: update Redis and publish notification
          mockRedisService._store.set(
            RedisKeys.HUMAN_INPUT('test-conversation'),
            JSON.stringify({
              conversationId: 'test-conversation',
              formSchema: objectSchemaWithAnswer,
              message: 'Question?',
              submitted: true,
              result: { answer: 'yes' },
            }),
          );

          // Trigger Pub/Sub notification
          await mockRedisService.client.publish(
            RedisKeys.HUMAN_INPUT('test-conversation'),
            'submitted',
          );

          const { result } = await collectEvents(generator);

          expect(result).toEqual({
            submitted: true,
            data: { answer: 'yes' },
          });
          expect(mockRedisService.del).toHaveBeenCalledWith(
            RedisKeys.HUMAN_INPUT('test-conversation'),
          );
        },
      );
    });

    it('should return result on successful submission', async () => {
      await TraceContext.run(
        { requestId: 'test-req', conversationId: 'test-conversation' },
        async () => {
          const ctx = createMockContext();

          const generator = tool.call(
            {
              message: 'Confirm?',
              formSchema: booleanSchema,
              timeout: 200,
            },
            ctx,
          );

          await generator.next();

          mockRedisService._store.set(
            RedisKeys.HUMAN_INPUT('test-conversation'),
            JSON.stringify({
              conversationId: 'test-conversation',
              formSchema: booleanSchema,
              message: 'Confirm?',
              submitted: true,
              result: { confirmed: true },
            }),
          );

          await mockRedisService.client.publish(
            RedisKeys.HUMAN_INPUT('test-conversation'),
            'submitted',
          );

          const { result } = await collectEvents(generator);

          expect(result).toEqual({
            submitted: true,
            data: { confirmed: true },
          });
        },
      );
    });
  });

  describe('call - timeout', () => {
    it('should return not submitted after timeout', async () => {
      await TraceContext.run(
        { requestId: 'test-req', conversationId: 'test-conversation' },
        async () => {
          const ctx = createMockContext();

          const generator = tool.call(
            {
              message: 'Confirm?',
              formSchema: booleanSchema,
              timeout: 10,
            },
            ctx,
          );

          const { result } = await collectEvents(generator);

          expect(result).toEqual({ submitted: false });
          expect(mockRedisService.del).toHaveBeenCalledWith(
            RedisKeys.HUMAN_INPUT('test-conversation'),
          );
        },
      );
    });

    it('should clean up Redis key on timeout', async () => {
      await TraceContext.run(
        { requestId: 'test-req', conversationId: 'test-conversation' },
        async () => {
          const ctx = createMockContext();

          const generator = tool.call(
            {
              message: 'Confirm?',
              formSchema: booleanSchema,
              timeout: 10,
            },
            ctx,
          );

          await collectEvents(generator);

          expect(mockRedisService.del).toHaveBeenCalledWith(
            RedisKeys.HUMAN_INPUT('test-conversation'),
          );
        },
      );
    });
  });

  describe('call - abort signal', () => {
    it('should throw immediately when signal is already aborted', async () => {
      const abortController = new AbortController();
      abortController.abort(new Error('User cancelled'));

      await TraceContext.run(
        {
          requestId: 'test-req',
          traceId: 'test-trace-id',
          conversationId: 'test-conversation',
        },
        async () => {
          const ctx = new ExecutionContext(abortController);

          const generator = tool.call(
            {
              message: 'Confirm?',
              formSchema: booleanSchema,
              timeout: 10000,
            },
            ctx,
          );

          await expect(generator.next()).rejects.toThrow('User cancelled');
        },
      );
    });

    it('should throw when signal is aborted during wait', async () => {
      const abortController = new AbortController();

      await TraceContext.run(
        {
          requestId: 'test-req',
          traceId: 'test-trace-id',
          conversationId: 'test-conversation',
        },
        async () => {
          const ctx = new ExecutionContext(abortController);

          const generator = tool.call(
            {
              message: 'Confirm?',
              formSchema: booleanSchema,
              timeout: 10000,
            },
            ctx,
          );

          await generator.next();

          setTimeout(
            () => abortController.abort(new Error('User cancelled')),
            50,
          );

          await expect(generator.next()).rejects.toThrow('User cancelled');
        },
      );
    });
  });

  describe('Redis key format', () => {
    it('should use conversationId from TraceContext as key suffix', async () => {
      await TraceContext.run(
        {
          requestId: 'test-req',
          traceId: 'custom-trace-id',
          conversationId: 'my-custom-conversation',
        },
        async () => {
          const customCtx = new ExecutionContext(new AbortController());

          const generator = tool.call(
            {
              message: 'Test',
              formSchema: booleanSchema,
              timeout: 10,
            },
            customCtx,
          );

          await generator.next();

          expect(mockRedisService.set).toHaveBeenCalledWith(
            RedisKeys.HUMAN_INPUT('my-custom-conversation'),
            expect.any(Object),
          );
        },
      );
    });
  });

  describe('stored data structure', () => {
    it('should store correct initial data in Redis', async () => {
      await TraceContext.run(
        { requestId: 'test-req', conversationId: 'test-conversation' },
        async () => {
          const ctx = createMockContext();

          const generator = tool.call(
            {
              message: 'Enter email',
              formSchema: objectSchemaWithEmail,
              timeout: 10,
            },
            ctx,
          );

          await generator.next();

          const storedData = JSON.parse(
            mockRedisService._store.get(
              RedisKeys.HUMAN_INPUT('test-conversation'),
            )!,
          );

          expect(storedData).toMatchObject({
            conversationId: 'test-conversation',
            message: 'Enter email',
            formSchema: objectSchemaWithEmail,
            submitted: false,
          });
          expect(storedData).toHaveProperty('createdAt');
        },
      );
    });
  });
});
