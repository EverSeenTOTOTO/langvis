import HumanInputController from '@/server/controller/HumanInputController';
import { RedisKeys } from '@/shared/constants';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function createMockRedisService() {
  const store = new Map<string, string>();
  const mockClient = {
    get: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    set: vi.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve('OK');
    }),
    del: vi.fn((key: string) => {
      store.delete(key);
      return Promise.resolve(1);
    }),
    publish: vi.fn(() => Promise.resolve(1)),
    // Mock eval for Lua script execution
    eval: vi.fn(
      (_script: string, options: { keys: string[]; arguments: string[] }) => {
        const key = options.keys[0];
        const data = store.get(key);

        if (!data) {
          return Promise.resolve([-1, '']);
        }

        const pending = JSON.parse(data);
        if (pending.submitted) {
          return Promise.resolve([0, '']);
        }

        // Update the data
        pending.submitted = true;
        pending.result = JSON.parse(options.arguments[0]);
        store.set(key, JSON.stringify(pending));

        return Promise.resolve([1, JSON.stringify(pending)]);
      },
    ),
  };

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
    client: mockClient,
    _store: store,
  };
}

function createMockResponse() {
  const res = {
    _status: 200,
    _json: null as any,
    status: vi.fn(function (this: any, code: number) {
      this._status = code;
      return this;
    }),
    json: vi.fn(function (this: any, data: any) {
      this._json = data;
      return this;
    }),
  };
  return res as any;
}

describe('HumanInputController', () => {
  let mockRedisService: ReturnType<typeof createMockRedisService>;
  let controller: HumanInputController;

  beforeEach(() => {
    mockRedisService = createMockRedisService();
    controller = new HumanInputController(mockRedisService as any);
    vi.clearAllMocks();
  });

  describe('submitInput', () => {
    it('should return 404 when request not found', async () => {
      const res = createMockResponse();
      await controller.submitInput(
        'nonexistent-message',
        { messageId: 'nonexistent-message', data: {} },
        res,
      );

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Request not found or expired',
      });
    });

    it('should return 400 when request already submitted', async () => {
      mockRedisService._store.set(
        RedisKeys.HUMAN_INPUT('test-message'),
        JSON.stringify({
          messageId: 'test-message',
          message: 'Test message',
          formSchema: { type: 'boolean' },
          submitted: true,
          result: { answer: 'no' },
        }),
      );

      const res = createMockResponse();
      await controller.submitInput(
        'test-message',
        {
          messageId: 'test-message',
          data: { answer: 'yes' },
        },
        res,
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Request already submitted',
      });
    });

    it('should successfully submit data', async () => {
      mockRedisService._store.set(
        RedisKeys.HUMAN_INPUT('test-message'),
        JSON.stringify({
          messageId: 'test-message',
          message: 'Test message',
          formSchema: {
            type: 'object',
            properties: { name: { type: 'string' } },
          },
          submitted: false,
          createdAt: Date.now(),
        }),
      );

      const res = createMockResponse();
      await controller.submitInput(
        'test-message',
        {
          messageId: 'test-message',
          data: { name: 'John' },
        },
        res,
      );

      expect(res.json).toHaveBeenCalledWith({ success: true });

      const stored = JSON.parse(
        mockRedisService._store.get(RedisKeys.HUMAN_INPUT('test-message'))!,
      );
      expect(stored.submitted).toBe(true);
      expect(stored.result).toEqual({ name: 'John' });
    });

    it('should publish notification after submission', async () => {
      mockRedisService._store.set(
        RedisKeys.HUMAN_INPUT('test-message'),
        JSON.stringify({
          messageId: 'test-message',
          message: 'Test message',
          formSchema: { type: 'object' },
          submitted: false,
          createdAt: Date.now(),
        }),
      );

      const res = createMockResponse();
      await controller.submitInput(
        'test-message',
        { messageId: 'test-message', data: { confirmed: true } },
        res,
      );

      // Lua script handles both update and publish atomically
      expect(mockRedisService.client.eval).toHaveBeenCalled();
      const evalCall = mockRedisService.client.eval.mock.calls[0];
      expect(evalCall[1].keys[0]).toBe(RedisKeys.HUMAN_INPUT('test-message'));
    });

    it('should preserve original message and schema after submission', async () => {
      const originalData = {
        messageId: 'test-message',
        message: 'Please confirm this action',
        formSchema: { type: 'boolean' },
        submitted: false,
        createdAt: 1234567890,
      };
      mockRedisService._store.set(
        RedisKeys.HUMAN_INPUT('test-message'),
        JSON.stringify(originalData),
      );

      const res = createMockResponse();
      await controller.submitInput(
        'test-message',
        {
          messageId: 'test-message',
          data: { confirmed: true },
        },
        res,
      );

      const stored = JSON.parse(
        mockRedisService._store.get(RedisKeys.HUMAN_INPUT('test-message'))!,
      );
      expect(stored.message).toBe('Please confirm this action');
      expect(stored.formSchema).toEqual({ type: 'boolean' });
      expect(stored.createdAt).toBe(1234567890);
    });
  });

  describe('getStatus', () => {
    it('should return exists: false when no request found', async () => {
      const res = createMockResponse();
      await controller.getStatus('nonexistent-message', res);

      expect(res.json).toHaveBeenCalledWith({ exists: false });
    });

    it('should return request status when exists and not submitted', async () => {
      mockRedisService._store.set(
        RedisKeys.HUMAN_INPUT('test-message'),
        JSON.stringify({
          messageId: 'test-message',
          message: 'Please confirm',
          formSchema: { type: 'boolean' },
          submitted: false,
          createdAt: Date.now(),
        }),
      );

      const res = createMockResponse();
      await controller.getStatus('test-message', res);

      expect(res.json).toHaveBeenCalledWith({
        exists: true,
        submitted: false,
        message: 'Please confirm',
        schema: { type: 'boolean' },
      });
    });

    it('should return request status when already submitted', async () => {
      mockRedisService._store.set(
        RedisKeys.HUMAN_INPUT('test-message'),
        JSON.stringify({
          messageId: 'test-message',
          message: 'Please confirm',
          formSchema: { type: 'boolean' },
          submitted: true,
          result: { confirmed: true },
        }),
      );

      const res = createMockResponse();
      await controller.getStatus('test-message', res);

      expect(res.json).toHaveBeenCalledWith({
        exists: true,
        submitted: true,
        message: 'Please confirm',
        schema: { type: 'boolean' },
      });
    });

    it('should not expose result data in status response', async () => {
      mockRedisService._store.set(
        RedisKeys.HUMAN_INPUT('test-message'),
        JSON.stringify({
          messageId: 'test-message',
          message: 'Enter password',
          formSchema: { type: 'string' },
          submitted: true,
          result: { password: 'secret123' },
        }),
      );

      const res = createMockResponse();
      await controller.getStatus('test-message', res);

      expect(res.json).toHaveBeenCalled();
      const callArg = res.json.mock.calls[0][0];
      expect(callArg).not.toHaveProperty('result');
      expect(callArg).not.toHaveProperty('data');
    });
  });

  describe('Redis key format', () => {
    it('should use correct Redis key prefix for submitInput', async () => {
      const res = createMockResponse();
      await controller.submitInput(
        'msg-123',
        { messageId: 'msg-123', data: {} },
        res,
      );
      // Lua script receives the key
      expect(mockRedisService.client.eval).toHaveBeenCalled();
      const evalCall = mockRedisService.client.eval.mock.calls[0];
      expect(evalCall[1].keys[0]).toBe(RedisKeys.HUMAN_INPUT('msg-123'));
    });

    it('should use correct Redis key prefix for getStatus', async () => {
      const res = createMockResponse();
      await controller.getStatus('msg-456', res);
      expect(mockRedisService.get).toHaveBeenCalledWith(
        RedisKeys.HUMAN_INPUT('msg-456'),
      );
    });
  });
});
