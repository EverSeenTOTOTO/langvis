import HumanInTheLoopTool from '@/server/core/tool/HumanInTheLoop';
import { ExecutionContext } from '@/server/core/context';
import { ToolIds } from '@/shared/constants';
import { Role } from '@/shared/types/entities';
import { JSONSchemaType } from 'ajv';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockContext } from '../../helpers/context';

const REDIS_PREFIX = 'human_input:';

function createMockRedis(
  subscriberNotify?: (channel: string, message: string) => void,
) {
  const store = new Map<string, string>();
  return {
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
    _store: store,
  };
}

function createMockRedisSubscriber() {
  const messageCallbacks = new Set<
    (channel: string, message: string) => void
  >();

  return {
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'message') {
        messageCallbacks.add(cb as (channel: string, message: string) => void);
      }
    }),
    off: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'message') {
        messageCallbacks.delete(
          cb as (channel: string, message: string) => void,
        );
      }
    }),
    subscribe: vi.fn(() => Promise.resolve()),
    unsubscribe: vi.fn(() => Promise.resolve()),
    _notify: (channel: string, message: string) => {
      messageCallbacks.forEach(cb => cb(channel, message));
    },
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
  let mockRedis: ReturnType<typeof createMockRedis>;
  let mockRedisSubscriber: ReturnType<typeof createMockRedisSubscriber>;
  let tool: HumanInTheLoopTool;

  beforeEach(() => {
    mockRedisSubscriber = createMockRedisSubscriber();
    mockRedis = createMockRedis(mockRedisSubscriber._notify);
    tool = new HumanInTheLoopTool(mockRedis as any, mockRedisSubscriber as any);
    (tool as any).id = ToolIds.HUMAN_IN_THE_LOOP;
    (tool as any).config = {};
    (tool as any).logger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    };
  });

  describe('basic properties', () => {
    it('should have correct tool id', () => {
      expect(tool.id).toBe(ToolIds.HUMAN_IN_THE_LOOP);
    });
  });

  describe('call - successful submission', () => {
    it('should create Redis entry with correct data', async () => {
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
        type: 'progress',
        toolName: ToolIds.HUMAN_IN_THE_LOOP,
        data: {
          status: 'awaiting_input',
          conversationId: 'test-conversation',
          message: 'Please enter your name',
          schema: objectSchemaWithName,
        },
      });

      expect(mockRedis.set).toHaveBeenCalledWith(
        `${REDIS_PREFIX}test-conversation`,
        expect.stringContaining('"submitted":false'),
      );

      await generator.return?.({ submitted: true });
    });

    it('should yield tool_progress event with awaiting_input status', async () => {
      const ctx = createMockContext();

      const generator = tool.call(
        { message: 'Confirm?', formSchema: booleanSchema, timeout: 50 },
        ctx,
      );

      const { value } = await generator.next();
      expect(value).toMatchObject({
        type: 'progress',
        toolName: ToolIds.HUMAN_IN_THE_LOOP,
        data: {
          status: 'awaiting_input',
        },
      });
    });

    it('should return submitted result when user submits data via Pub/Sub', async () => {
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
      mockRedis._store.set(
        `${REDIS_PREFIX}test-conversation`,
        JSON.stringify({
          conversationId: 'test-conversation',
          formSchema: objectSchemaWithAnswer,
          message: 'Question?',
          submitted: true,
          result: { answer: 'yes' },
        }),
      );

      // Trigger Pub/Sub notification
      await mockRedis.publish(`${REDIS_PREFIX}test-conversation`, 'submitted');

      const { result } = await collectEvents(generator);

      expect(result).toEqual({
        submitted: true,
        data: { answer: 'yes' },
      });
      expect(mockRedis.del).toHaveBeenCalledWith(
        `${REDIS_PREFIX}test-conversation`,
      );
    });

    it('should yield tool_result event on successful submission', async () => {
      const ctx = createMockContext();

      const generator = tool.call(
        { message: 'Confirm?', formSchema: booleanSchema, timeout: 200 },
        ctx,
      );

      await generator.next();

      mockRedis._store.set(
        `${REDIS_PREFIX}test-conversation`,
        JSON.stringify({
          conversationId: 'test-conversation',
          formSchema: booleanSchema,
          message: 'Confirm?',
          submitted: true,
          result: { confirmed: true },
        }),
      );

      await mockRedis.publish(`${REDIS_PREFIX}test-conversation`, 'submitted');

      const { events } = await collectEvents(generator);

      const resultEvent = events.find(e => (e as any).type === 'result');
      expect(resultEvent).toMatchObject({
        type: 'result',
        toolName: ToolIds.HUMAN_IN_THE_LOOP,
        output: { submitted: true, data: { confirmed: true } },
      });
    });
  });

  describe('call - timeout', () => {
    it('should return not submitted after timeout', async () => {
      const ctx = createMockContext();

      const generator = tool.call(
        { message: 'Confirm?', formSchema: booleanSchema, timeout: 10 },
        ctx,
      );

      const { result } = await collectEvents(generator);

      expect(result).toEqual({ submitted: false });
      expect(mockRedis.del).toHaveBeenCalledWith(
        `${REDIS_PREFIX}test-conversation`,
      );
    });

    it('should clean up Redis key on timeout', async () => {
      const ctx = createMockContext();

      const generator = tool.call(
        { message: 'Confirm?', formSchema: booleanSchema, timeout: 10 },
        ctx,
      );

      await collectEvents(generator);

      expect(mockRedis.del).toHaveBeenCalledWith(
        `${REDIS_PREFIX}test-conversation`,
      );
    });
  });

  describe('call - abort signal', () => {
    it('should throw immediately when signal is already aborted', async () => {
      const abortController = new AbortController();
      abortController.abort(new Error('User cancelled'));

      const ctx = new ExecutionContext(
        {
          id: 'test-trace-id',
          role: Role.ASSIST,
          content: '',
          conversationId: 'test-conversation',
          createdAt: new Date(),
        },
        abortController,
      );

      const generator = tool.call(
        { message: 'Confirm?', formSchema: booleanSchema, timeout: 10000 },
        ctx,
      );

      await expect(generator.next()).rejects.toThrow('User cancelled');
    });

    it('should throw when signal is aborted during wait', async () => {
      const abortController = new AbortController();
      const ctx = new ExecutionContext(
        {
          id: 'test-trace-id',
          role: Role.ASSIST,
          content: '',
          conversationId: 'test-conversation',
          createdAt: new Date(),
        },
        abortController,
      );

      const generator = tool.call(
        { message: 'Confirm?', formSchema: booleanSchema, timeout: 10000 },
        ctx,
      );

      await generator.next();

      setTimeout(() => abortController.abort(new Error('User cancelled')), 50);

      await expect(generator.next()).rejects.toThrow('User cancelled');
    });
  });

  describe('Redis key format', () => {
    it('should use conversationId as key suffix', async () => {
      const customCtx = new ExecutionContext(
        {
          id: 'custom-trace-id',
          role: Role.ASSIST,
          content: '',
          conversationId: 'my-custom-conversation',
          createdAt: new Date(),
        },
        new AbortController(),
      );

      const generator = tool.call(
        { message: 'Test', formSchema: booleanSchema, timeout: 10 },
        customCtx,
      );

      await generator.next();

      expect(mockRedis.set).toHaveBeenCalledWith(
        `${REDIS_PREFIX}my-custom-conversation`,
        expect.any(String),
      );
    });
  });

  describe('stored data structure', () => {
    it('should store correct initial data in Redis', async () => {
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
        mockRedis._store.get(`${REDIS_PREFIX}test-conversation`)!,
      );

      expect(storedData).toMatchObject({
        conversationId: 'test-conversation',
        message: 'Enter email',
        formSchema: objectSchemaWithEmail,
        submitted: false,
      });
      expect(storedData).toHaveProperty('createdAt');
    });
  });
});
