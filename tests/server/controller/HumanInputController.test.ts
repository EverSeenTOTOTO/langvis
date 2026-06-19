import HumanInputController from '@/server/controller/HumanInputController';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HumanInputPort } from '@/server/modules/conversation/domain/port/human-input.port';

function makeMockHumanInputPort(): HumanInputPort {
  return {
    submit: vi.fn(),
    getStatus: vi.fn(),
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
  let mockHumanInput: HumanInputPort;
  let controller: HumanInputController;

  beforeEach(() => {
    mockHumanInput = makeMockHumanInputPort();
    controller = new HumanInputController(mockHumanInput);
    vi.clearAllMocks();
  });

  describe('submitInput', () => {
    it('should return 404 when request not found', async () => {
      (mockHumanInput.submit as any).mockResolvedValue('not_found');

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
      (mockHumanInput.submit as any).mockResolvedValue('already_submitted');

      const res = createMockResponse();
      await controller.submitInput(
        'test-message',
        { messageId: 'test-message', data: { answer: 'yes' } },
        res,
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Request already submitted',
      });
    });

    it('should successfully submit data', async () => {
      (mockHumanInput.submit as any).mockResolvedValue('success');

      const res = createMockResponse();
      await controller.submitInput(
        'test-message',
        { messageId: 'test-message', data: { name: 'John' } },
        res,
      );

      expect(res.json).toHaveBeenCalledWith({ success: true });
      expect(mockHumanInput.submit).toHaveBeenCalledWith('test-message', {
        name: 'John',
      });
    });
  });

  describe('getStatus', () => {
    it('should return exists: false when no request found', async () => {
      (mockHumanInput.getStatus as any).mockResolvedValue(null);

      const res = createMockResponse();
      await controller.getStatus('nonexistent-message', res);

      expect(res.json).toHaveBeenCalledWith({ exists: false });
    });

    it('should return request status when exists and not submitted', async () => {
      (mockHumanInput.getStatus as any).mockResolvedValue({
        exists: true,
        submitted: false,
        message: 'Please confirm',
        schema: { type: 'boolean' },
      });

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
      (mockHumanInput.getStatus as any).mockResolvedValue({
        exists: true,
        submitted: true,
        message: 'Please confirm',
        schema: { type: 'boolean' },
      });

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
      (mockHumanInput.getStatus as any).mockResolvedValue({
        exists: true,
        submitted: true,
        message: 'Enter password',
        schema: { type: 'string' },
      });

      const res = createMockResponse();
      await controller.getStatus('test-message', res);

      expect(res.json).toHaveBeenCalled();
      const callArg = res.json.mock.calls[0][0];
      expect(callArg).not.toHaveProperty('result');
      expect(callArg).not.toHaveProperty('data');
    });
  });
});
