import HumanInputController from '@/server/controller/HumanInputController';
import { RedisKeys } from '@/shared/constants';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function createMockRedis() {
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
  let mockRedis: ReturnType<typeof createMockRedis>;
  let controller: HumanInputController;

  beforeEach(() => {
    mockRedis = createMockRedis();
    controller = new HumanInputController(mockRedis as any);
    vi.clearAllMocks();
  });

  describe('submitInput', () => {
    it('should return 404 when request not found', async () => {
      const res = createMockResponse();
      await controller.submitInput(
        'nonexistent-conversation',
        { conversationId: 'nonexistent-conversation', data: {} },
        res,
      );

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Request not found or expired',
      });
    });

    it('should return 400 when request already submitted', async () => {
      mockRedis._store.set(
        RedisKeys.HUMAN_INPUT('test-conversation'),
        JSON.stringify({
          conversationId: 'test-conversation',
          message: 'Test message',
          formSchema: { type: 'boolean' },
          submitted: true,
          result: { answer: 'no' },
        }),
      );

      const res = createMockResponse();
      await controller.submitInput(
        'test-conversation',
        {
          conversationId: 'test-conversation',
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
      mockRedis._store.set(
        RedisKeys.HUMAN_INPUT('test-conversation'),
        JSON.stringify({
          conversationId: 'test-conversation',
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
        'test-conversation',
        {
          conversationId: 'test-conversation',
          data: { name: 'John' },
        },
        res,
      );

      expect(res.json).toHaveBeenCalledWith({ success: true });

      const stored = JSON.parse(
        mockRedis._store.get(RedisKeys.HUMAN_INPUT('test-conversation'))!,
      );
      expect(stored.submitted).toBe(true);
      expect(stored.result).toEqual({ name: 'John' });
    });

    it('should publish notification after submission', async () => {
      mockRedis._store.set(
        RedisKeys.HUMAN_INPUT('test-conversation'),
        JSON.stringify({
          conversationId: 'test-conversation',
          message: 'Test message',
          formSchema: { type: 'object' },
          submitted: false,
          createdAt: Date.now(),
        }),
      );

      const res = createMockResponse();
      await controller.submitInput(
        'test-conversation',
        { conversationId: 'test-conversation', data: { confirmed: true } },
        res,
      );

      // Lua script handles both update and publish atomically
      expect(mockRedis.eval).toHaveBeenCalled();
      const evalCall = mockRedis.eval.mock.calls[0];
      expect(evalCall[1].keys[0]).toBe(
        RedisKeys.HUMAN_INPUT('test-conversation'),
      );
    });

    it('should preserve original message and schema after submission', async () => {
      const originalData = {
        conversationId: 'test-conversation',
        message: 'Please confirm this action',
        formSchema: { type: 'boolean' },
        submitted: false,
        createdAt: 1234567890,
      };
      mockRedis._store.set(
        RedisKeys.HUMAN_INPUT('test-conversation'),
        JSON.stringify(originalData),
      );

      const res = createMockResponse();
      await controller.submitInput(
        'test-conversation',
        {
          conversationId: 'test-conversation',
          data: { confirmed: true },
        },
        res,
      );

      const stored = JSON.parse(
        mockRedis._store.get(RedisKeys.HUMAN_INPUT('test-conversation'))!,
      );
      expect(stored.message).toBe('Please confirm this action');
      expect(stored.formSchema).toEqual({ type: 'boolean' });
      expect(stored.createdAt).toBe(1234567890);
    });
  });

  describe('getStatus', () => {
    it('should return exists: false when no request found', async () => {
      const res = createMockResponse();
      await controller.getStatus('nonexistent-conversation', res);

      expect(res.json).toHaveBeenCalledWith({ exists: false });
    });

    it('should return request status when exists and not submitted', async () => {
      mockRedis._store.set(
        RedisKeys.HUMAN_INPUT('test-conversation'),
        JSON.stringify({
          conversationId: 'test-conversation',
          message: 'Please confirm',
          formSchema: { type: 'boolean' },
          submitted: false,
          createdAt: Date.now(),
        }),
      );

      const res = createMockResponse();
      await controller.getStatus('test-conversation', res);

      expect(res.json).toHaveBeenCalledWith({
        exists: true,
        submitted: false,
        message: 'Please confirm',
        schema: { type: 'boolean' },
      });
    });

    it('should return request status when already submitted', async () => {
      mockRedis._store.set(
        RedisKeys.HUMAN_INPUT('test-conversation'),
        JSON.stringify({
          conversationId: 'test-conversation',
          message: 'Please confirm',
          formSchema: { type: 'boolean' },
          submitted: true,
          result: { confirmed: true },
        }),
      );

      const res = createMockResponse();
      await controller.getStatus('test-conversation', res);

      expect(res.json).toHaveBeenCalledWith({
        exists: true,
        submitted: true,
        message: 'Please confirm',
        schema: { type: 'boolean' },
      });
    });

    it('should not expose result data in status response', async () => {
      mockRedis._store.set(
        RedisKeys.HUMAN_INPUT('test-conversation'),
        JSON.stringify({
          conversationId: 'test-conversation',
          message: 'Enter password',
          formSchema: { type: 'string' },
          submitted: true,
          result: { password: 'secret123' },
        }),
      );

      const res = createMockResponse();
      await controller.getStatus('test-conversation', res);

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
        'conv-123',
        { conversationId: 'conv-123', data: {} },
        res,
      );
      // Lua script receives the key
      expect(mockRedis.eval).toHaveBeenCalled();
      const evalCall = mockRedis.eval.mock.calls[0];
      expect(evalCall[1].keys[0]).toBe(RedisKeys.HUMAN_INPUT('conv-123'));
    });

    it('should use correct Redis key prefix for getStatus', async () => {
      const res = createMockResponse();
      await controller.getStatus('conv-456', res);
      expect(mockRedis.get).toHaveBeenCalledWith(
        RedisKeys.HUMAN_INPUT('conv-456'),
      );
    });
  });
});
