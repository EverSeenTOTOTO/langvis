import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response } from 'express';

const mockEmailService = {
  list: vi.fn(),
  getById: vi.fn(),
  delete: vi.fn(),
  updateStatus: vi.fn(),
  processInbound: vi.fn(),
};

const mockConversationService = {
  createConversation: vi.fn(),
  batchAddMessages: vi.fn(),
  getConversationById: vi.fn(),
  getMessagesByConversationId: vi.fn(),
  updateMessage: vi.fn(),
};

const mockChatService = {
  getSessionState: vi.fn(),
  acquireSession: vi.fn(),
  runSession: vi.fn(),
  updateSessionPhase: vi.fn(),
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

vi.mock('@/server/service/EmailService', () => ({
  EmailService: class {
    list = mockEmailService.list;
    getById = mockEmailService.getById;
    delete = mockEmailService.delete;
    updateStatus = mockEmailService.updateStatus;
    processInbound = mockEmailService.processInbound;
  },
}));

vi.mock('@/server/service/ConversationService', () => ({
  ConversationService: class {
    createConversation = mockConversationService.createConversation;
    batchAddMessages = mockConversationService.batchAddMessages;
    getConversationById = mockConversationService.getConversationById;
    getMessagesByConversationId =
      mockConversationService.getMessagesByConversationId;
    updateMessage = mockConversationService.updateMessage;
  },
}));

vi.mock('@/server/service/ChatService', () => ({
  ChatService: class {
    getSessionState = mockChatService.getSessionState;
    acquireSession = mockChatService.acquireSession;
    runSession = mockChatService.runSession;
    updateSessionPhase = mockChatService.updateSessionPhase;
  },
}));

vi.mock('@/server/service/AuthService', () => ({
  AuthService: class {
    getUserId = mockAuthService.getUserId;
  },
}));

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

      const { default: EmailController } = await import(
        '@/server/controller/EmailController'
      );
      const emailController = new EmailController(
        mockEmailService as any,
        mockConversationService as any,
        mockChatService as any,
        mockAuthService as any,
      );

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

      const { default: EmailController } = await import(
        '@/server/controller/EmailController'
      );
      const emailController = new EmailController(
        mockEmailService as any,
        mockConversationService as any,
        mockChatService as any,
        mockAuthService as any,
      );

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

      const { default: EmailController } = await import(
        '@/server/controller/EmailController'
      );
      const emailController = new EmailController(
        mockEmailService as any,
        mockConversationService as any,
        mockChatService as any,
        mockAuthService as any,
      );

      await emailController.getById('mail_1', mockRes as Response);

      expect(mockEmailService.getById).toHaveBeenCalledWith('mail_1');
      expect(mockRes.json).toHaveBeenCalledWith(mockEmail);
    });

    it('should return 404 if email not found', async () => {
      mockEmailService.getById.mockResolvedValue(null);

      const { default: EmailController } = await import(
        '@/server/controller/EmailController'
      );
      const emailController = new EmailController(
        mockEmailService as any,
        mockConversationService as any,
        mockChatService as any,
        mockAuthService as any,
      );

      await emailController.getById('non-existent', mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Email not found' });
    });
  });

  describe('delete', () => {
    it('should delete email successfully', async () => {
      mockEmailService.delete.mockResolvedValue(true);

      const { default: EmailController } = await import(
        '@/server/controller/EmailController'
      );
      const emailController = new EmailController(
        mockEmailService as any,
        mockConversationService as any,
        mockChatService as any,
        mockAuthService as any,
      );

      await emailController.delete('mail_1', mockRes as Response);

      expect(mockEmailService.delete).toHaveBeenCalledWith('mail_1');
      expect(mockRes.json).toHaveBeenCalledWith({ success: true });
    });

    it('should return 404 if email not found', async () => {
      mockEmailService.delete.mockResolvedValue(false);

      const { default: EmailController } = await import(
        '@/server/controller/EmailController'
      );
      const emailController = new EmailController(
        mockEmailService as any,
        mockConversationService as any,
        mockChatService as any,
        mockAuthService as any,
      );

      await emailController.delete('non-existent', mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Email not found' });
    });
  });

  describe('handleInbound', () => {
    it('should return 401 if secret header is missing', async () => {
      vi.stubEnv('VITE_INBOUND_SECRET', 'test-secret');
      vi.resetModules();

      const { default: EmailController } = await import(
        '@/server/controller/EmailController'
      );
      const emailController = new EmailController(
        mockEmailService as any,
        mockConversationService as any,
        mockChatService as any,
        mockAuthService as any,
      );

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

      const { default: EmailController } = await import(
        '@/server/controller/EmailController'
      );
      const emailController = new EmailController(
        mockEmailService as any,
        mockConversationService as any,
        mockChatService as any,
        mockAuthService as any,
      );

      await emailController.handleInbound(
        { raw: 'test' },
        mockReq as Request,
        mockRes as Response,
      );

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
      vi.unstubAllEnvs();
    });

    it('should return 400 if raw content is missing', async () => {
      vi.stubEnv('VITE_INBOUND_SECRET', 'test-secret');
      vi.resetModules();
      mockReq.headers = { 'x-inbound-secret': 'test-secret' };

      const { default: EmailController } = await import(
        '@/server/controller/EmailController'
      );
      const emailController = new EmailController(
        mockEmailService as any,
        mockConversationService as any,
        mockChatService as any,
        mockAuthService as any,
      );

      await emailController.handleInbound(
        {} as any,
        mockReq as Request,
        mockRes as Response,
      );

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Missing raw email content',
      });
      vi.unstubAllEnvs();
    });

    it('should archive email successfully', async () => {
      vi.stubEnv('VITE_INBOUND_SECRET', 'test-secret');
      vi.resetModules();
      mockReq.headers = { 'x-inbound-secret': 'test-secret' };

      mockEmailService.processInbound.mockResolvedValue({
        success: true,
        id: 'mail_new',
      });

      const { default: EmailController } = await import(
        '@/server/controller/EmailController'
      );
      const emailController = new EmailController(
        mockEmailService as any,
        mockConversationService as any,
        mockChatService as any,
        mockAuthService as any,
      );

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

      expect(mockEmailService.processInbound).toHaveBeenCalledWith(rawEmail);
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

      mockEmailService.processInbound.mockResolvedValue({
        success: false,
        error: 'Database error',
      });

      const { default: EmailController } = await import(
        '@/server/controller/EmailController'
      );
      const emailController = new EmailController(
        mockEmailService as any,
        mockConversationService as any,
        mockChatService as any,
        mockAuthService as any,
      );

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
});
