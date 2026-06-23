import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response } from 'express';

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

vi.mock('@/server/libs/ddd', async importOriginal => {
  const actual = await importOriginal<typeof import('@/server/libs/ddd')>();
  return {
    ...actual,
    CommandBus: class {
      execute = mockCommandBus.execute;
    },
  };
});

vi.mock('@/server/libs/infrastructure/auth.service', () => ({
  AuthService: class {
    getUserId = mockAuthService.getUserId;
  },
}));

async function createController() {
  const { default: EmailController } = await import(
    '@/server/controller/EmailController'
  );
  return new EmailController(
    mockEmailService as any,
    mockCommandBus as any,
    mockAuthService as any,
  );
}

describe('EmailController', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockReq = {
      headers: {},
    };
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    };
  });

  describe('list', () => {
    it('should list emails with default pagination', async () => {
      const mockResult = {
        items: [
          {
            id: 'mail_1',
            messageId: '<test@example.com>',
            from: 'sender@example.com',
            fromName: 'Sender',
            to: 'recipient@example.com',
            subject: 'Test Subject',
            sentAt: new Date(),
            receivedAt: new Date(),
            attachmentCount: 0,
            attachmentNames: null,
            createdAt: new Date(),
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      };

      mockEmailService.list.mockResolvedValue(mockResult);

      const emailController = await createController();

      await emailController.list({}, mockRes as Response);

      expect(mockEmailService.list).toHaveBeenCalledWith({
        from: undefined,
        subject: undefined,
        startDate: undefined,
        endDate: undefined,
        page: undefined,
        pageSize: undefined,
      });
      expect(mockRes.json).toHaveBeenCalledWith(mockResult);
    });

    it('should list emails with filters and parse page/pageSize', async () => {
      const mockResult = {
        items: [],
        total: 0,
        page: 2,
        pageSize: 10,
      };

      mockEmailService.list.mockResolvedValue(mockResult);

      const emailController = await createController();

      await emailController.list(
        {
          from: 'sender@test.com',
          subject: 'test',
          startDate: '2024-01-01',
          endDate: '2024-12-31',
          page: 2,
          pageSize: 10,
        },
        mockRes as Response,
      );

      expect(mockEmailService.list).toHaveBeenCalledWith({
        from: 'sender@test.com',
        subject: 'test',
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        page: 2,
        pageSize: 10,
      });
      expect(mockRes.json).toHaveBeenCalledWith(mockResult);
    });
  });

  describe('getById', () => {
    it('should get email by id', async () => {
      const mockEmail = {
        id: 'mail_1',
        messageId: '<test@example.com>',
        from: 'sender@example.com',
        fromName: 'Sender',
        to: 'recipient@example.com',
        subject: 'Test Subject',
        content: 'Test content',
        sentAt: new Date(),
        receivedAt: new Date(),
        attachmentCount: 0,
        attachmentNames: null,
        metadata: null,
        createdAt: new Date(),
      };

      mockEmailService.getById.mockResolvedValue(mockEmail);

      const emailController = await createController();

      await emailController.getById('mail_1', mockRes as Response);

      expect(mockEmailService.getById).toHaveBeenCalledWith('mail_1');
      expect(mockRes.json).toHaveBeenCalledWith(mockEmail);
    });

    it('should return 404 if email not found', async () => {
      mockEmailService.getById.mockResolvedValue(null);

      const emailController = await createController();

      await emailController.getById('non-existent', mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Email not found' });
    });
  });

  describe('delete', () => {
    it('should delete email successfully', async () => {
      mockEmailService.delete.mockResolvedValue(true);

      const emailController = await createController();

      await emailController.delete('mail_1', mockRes as Response);

      expect(mockEmailService.delete).toHaveBeenCalledWith('mail_1');
      expect(mockRes.json).toHaveBeenCalledWith({ success: true });
    });

    it('should return 404 if email not found', async () => {
      mockEmailService.delete.mockResolvedValue(false);

      const emailController = await createController();

      await emailController.delete('non-existent', mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Email not found' });
    });
  });

  describe('handleInbound', () => {
    it('should return 401 if secret header is missing', async () => {
      vi.stubEnv('VITE_INBOUND_SECRET', 'test-secret');
      vi.resetModules();

      const emailController = await createController();

      await emailController.handleInbound(
        { raw: 'test' },
        mockReq as Request,
        mockRes as Response,
      );

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
      vi.unstubAllEnvs();
    });

    it('should return 401 if secret is invalid', async () => {
      vi.stubEnv('VITE_INBOUND_SECRET', 'test-secret');
      vi.resetModules();
      mockReq.headers = { 'x-inbound-secret': 'wrong-secret' };

      const emailController = await createController();

      await emailController.handleInbound(
        { raw: 'test' },
        mockReq as Request,
        mockRes as Response,
      );

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
      vi.unstubAllEnvs();
    });

    it('should delegate to CommandBus for inbound processing', async () => {
      vi.stubEnv('VITE_INBOUND_SECRET', 'test-secret');
      vi.resetModules();
      mockReq.headers = { 'x-inbound-secret': 'test-secret' };

      mockCommandBus.execute.mockResolvedValue({
        success: true,
        id: 'mail_new',
      });

      const emailController = await createController();

      const rawEmail = `From: sender@example.com
To: recipient@example.com
Subject: Test Subject
Message-ID: <msg123@example.com>
Date: Mon, 1 Jan 2024 12:00:00 +0000

This is the email body content.`;

      await emailController.handleInbound(
        { raw: rawEmail },
        mockReq as Request,
        mockRes as Response,
      );

      expect(mockCommandBus.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          rawEmail: rawEmail,
        }),
      );
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        id: 'mail_new',
      });
      vi.unstubAllEnvs();
    });

    it('should return 500 if archive fails', async () => {
      vi.stubEnv('VITE_INBOUND_SECRET', 'test-secret');
      vi.resetModules();
      mockReq.headers = { 'x-inbound-secret': 'test-secret' };

      mockCommandBus.execute.mockResolvedValue({
        success: false,
        error: 'Database error',
      });

      const emailController = await createController();

      const rawEmail = `From: sender@example.com
To: recipient@example.com
Subject: Test Subject
Message-ID: <msg123@example.com>

Test content.`;

      await emailController.handleInbound(
        { raw: rawEmail },
        mockReq as Request,
        mockRes as Response,
      );

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Database error' });
      vi.unstubAllEnvs();
    });
  });

  describe('archive', () => {
    it('should delegate to CommandBus and return result', async () => {
      mockAuthService.getUserId.mockResolvedValue('user_1');
      mockCommandBus.execute.mockResolvedValue({
        emailId: 'mail_1',
        conversationId: 'conv_1',
      });

      const emailController = await createController();

      await emailController.archive(
        'mail_1',
        mockReq as Request,
        mockRes as Response,
      );

      expect(mockAuthService.getUserId).toHaveBeenCalledWith(mockReq);
      expect(mockCommandBus.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          emailId: 'mail_1',
          userId: 'user_1',
        }),
      );
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        conversationId: 'conv_1',
      });
    });
  });
});
