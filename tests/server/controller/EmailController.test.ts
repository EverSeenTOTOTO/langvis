import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import type { Request } from 'express';

const mockEmailService = {
  list: vi.fn(),
  getById: vi.fn(),
  delete: vi.fn(),
};

const mockCommandBus = {
  execute: vi.fn(),
};

const mockAuthService = {
  getUserId: vi.fn(),
};

vi.mock('@/server/utils/logger', () => ({
  default: {
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

vi.mock('@/server/modules/email/application/service/email.service', () => ({
  EmailService: class {
    list = mockEmailService.list;
    getById = mockEmailService.getById;
    delete = mockEmailService.delete;
  },
}));

vi.mock('@/server/shared/ddd', async importOriginal => {
  const actual = await importOriginal<typeof import('@/server/shared/ddd')>();
  return {
    ...actual,
    CommandBus: class {
      execute = mockCommandBus.execute;
    },
  };
});

vi.mock('@/server/shared/infrastructure/auth.service', () => ({
  AuthService: class {
    getUserId = mockAuthService.getUserId;
  },
}));

async function createController() {
  const { EmailController } = await import(
    '@/server/modules/email/email.controller'
  );
  return new EmailController(
    mockEmailService as never,
    mockCommandBus as never,
    mockAuthService as never,
  );
}

const expectHttpError = async (
  promise: Promise<unknown>,
  status: number,
  body: Record<string, unknown>,
) => {
  const err = (await promise.catch(e => e)) as HttpException;
  expect(err).toBeInstanceOf(HttpException);
  expect(err.getStatus()).toBe(status);
  expect(err.getResponse()).toMatchObject(body);
};

describe('EmailController', () => {
  let mockReq: Partial<Request>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockReq = { headers: {} };
  });

  describe('list', () => {
    it('透传过滤条件并返回结果', async () => {
      const result = { items: [], total: 0, page: 1, pageSize: 20 };
      mockEmailService.list.mockResolvedValue(result);

      const controller = await createController();
      await expect(
        controller.list({
          from: 'sender@test.com',
          subject: 'test',
          page: 2,
          pageSize: 10,
        } as never),
      ).resolves.toBe(result);
      expect(mockEmailService.list).toHaveBeenCalledWith({
        from: 'sender@test.com',
        subject: 'test',
        startDate: undefined,
        endDate: undefined,
        status: undefined,
        page: 2,
        pageSize: 10,
      });
    });
  });

  describe('getById', () => {
    it('命中返回邮件', async () => {
      const email = { id: 'mail_1', subject: 'S' };
      mockEmailService.getById.mockResolvedValue(email);
      const controller = await createController();
      await expect(controller.getById('mail_1')).resolves.toBe(email);
    });

    it('未命中抛 404', async () => {
      mockEmailService.getById.mockResolvedValue(null);
      const controller = await createController();
      await expectHttpError(controller.getById('none'), 404, {
        error: 'Email not found',
      });
    });
  });

  describe('delete', () => {
    it('成功返回 success', async () => {
      mockEmailService.delete.mockResolvedValue(true);
      const controller = await createController();
      await expect(controller.delete('mail_1')).resolves.toEqual({
        success: true,
      });
    });

    it('未命中抛 404', async () => {
      mockEmailService.delete.mockResolvedValue(false);
      const controller = await createController();
      await expectHttpError(controller.delete('none'), 404, {
        error: 'Email not found',
      });
    });
  });

  describe('handleInbound', () => {
    it('缺 secret 头抛 401', async () => {
      vi.stubEnv('VITE_INBOUND_SECRET', 'test-secret');
      vi.resetModules();
      const controller = await createController();
      await expectHttpError(
        controller.handleInbound({ raw: 'test' }, mockReq as Request),
        401,
        { error: 'Unauthorized' },
      );
      vi.unstubAllEnvs();
    });

    it('secret 错误抛 401', async () => {
      vi.stubEnv('VITE_INBOUND_SECRET', 'test-secret');
      vi.resetModules();
      mockReq.headers = { 'x-inbound-secret': 'wrong-secret' };
      const controller = await createController();
      await expectHttpError(
        controller.handleInbound({ raw: 'test' }, mockReq as Request),
        401,
        { error: 'Unauthorized' },
      );
      vi.unstubAllEnvs();
    });

    it('secret 正确委托 CommandBus 并返回结果', async () => {
      vi.stubEnv('VITE_INBOUND_SECRET', 'test-secret');
      vi.resetModules();
      mockReq.headers = { 'x-inbound-secret': 'test-secret' };
      mockCommandBus.execute.mockResolvedValue({
        success: true,
        id: 'mail_new',
      });

      const controller = await createController();
      await expect(
        controller.handleInbound({ raw: 'RAW' }, mockReq as Request),
      ).resolves.toEqual({ success: true, id: 'mail_new' });
      expect(mockCommandBus.execute).toHaveBeenCalledWith(
        expect.objectContaining({ rawEmail: 'RAW' }),
      );
      vi.unstubAllEnvs();
    });

    it('归档失败抛 500 + 错误信息', async () => {
      vi.stubEnv('VITE_INBOUND_SECRET', 'test-secret');
      vi.resetModules();
      mockReq.headers = { 'x-inbound-secret': 'test-secret' };
      mockCommandBus.execute.mockResolvedValue({
        success: false,
        error: 'Database error',
      });

      const controller = await createController();
      await expectHttpError(
        controller.handleInbound({ raw: 'RAW' }, mockReq as Request),
        500,
        { error: 'Database error' },
      );
      vi.unstubAllEnvs();
    });
  });

  describe('archive', () => {
    it('委托 CommandBus 并返回 conversationId', async () => {
      mockAuthService.getUserId.mockResolvedValue('user_1');
      mockCommandBus.execute.mockResolvedValue({
        emailId: 'mail_1',
        conversationId: 'conv_1',
      });

      const controller = await createController();
      await expect(
        controller.archive('mail_1', mockReq as Request),
      ).resolves.toEqual({ conversationId: 'conv_1' });
      expect(mockCommandBus.execute).toHaveBeenCalledWith(
        expect.objectContaining({ emailId: 'mail_1', userId: 'user_1' }),
      );
    });
  });
});
