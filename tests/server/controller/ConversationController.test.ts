import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConversationController } from '@/server/controller/ConversationController';
import { Role } from '@/shared/entities/Message';
import type { Request, Response } from 'express';

describe('ConversationController', () => {
  let conversationController: ConversationController;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  const mockConversationService = {
    createConversation: vi.fn(),
    getAllConversations: vi.fn(),
    getConversationById: vi.fn(),
    updateConversation: vi.fn(),
    deleteConversation: vi.fn(),
    addMessageToConversation: vi.fn(),
    getMessagesByConversationId: vi.fn(),
    batchDeleteMessagesInConversation: vi.fn(),
  };

  beforeEach(() => {
    conversationController = new ConversationController(
      mockConversationService as any,
    );
    mockReq = {};
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    };
  });

  it('should create a conversation', async () => {
    const mockConversation = {
      id: '1',
      name: 'Test Conversation',
      createdAt: new Date(),
    };

    mockReq.body = { name: 'Test Conversation' };
    mockConversationService.createConversation.mockResolvedValue(
      mockConversation,
    );

    await conversationController.createConversation(
      mockReq as Request,
      mockRes as Response,
    );

    expect(mockRes.status).toHaveBeenCalledWith(201);
    expect(mockRes.json).toHaveBeenCalledWith(mockConversation);
  });

  it('should return 400 if name is missing when creating a conversation', async () => {
    mockReq.body = {};

    await conversationController.createConversation(
      mockReq as Request,
      mockRes as Response,
    );

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({ error: 'Name is required' });
  });

  it('should get all conversations', async () => {
    const mockConversations = [
      {
        id: '1',
        name: 'Test Conversation 1',
        createdAt: new Date(),
      },
      {
        id: '2',
        name: 'Test Conversation 2',
        createdAt: new Date(),
      },
    ];

    mockConversationService.getAllConversations.mockResolvedValue(
      mockConversations,
    );

    await conversationController.getAllConversations(
      mockReq as Request,
      mockRes as Response,
    );

    expect(mockRes.json).toHaveBeenCalledWith(mockConversations);
  });

  it('should get a conversation by id', async () => {
    const mockConversation = {
      id: '1',
      name: 'Test Conversation',
      createdAt: new Date(),
    };

    mockReq.params = { id: '1' };
    mockConversationService.getConversationById.mockResolvedValue(
      mockConversation,
    );

    await conversationController.getConversationById(
      mockReq as Request,
      mockRes as Response,
    );

    expect(mockRes.json).toHaveBeenCalledWith(mockConversation);
  });

  it('should return 404 if conversation not found when getting by id', async () => {
    mockReq.params = { id: '1' };
    mockConversationService.getConversationById.mockResolvedValue(null);

    await conversationController.getConversationById(
      mockReq as Request,
      mockRes as Response,
    );

    expect(mockRes.status).toHaveBeenCalledWith(404);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: 'Conversation not found',
    });
  });

  it('should update a conversation', async () => {
    const mockConversation = {
      id: '1',
      name: 'Updated Conversation',
      createdAt: new Date(),
    };

    mockReq.params = { id: '1' };
    mockReq.body = { name: 'Updated Conversation' };
    mockConversationService.updateConversation.mockResolvedValue(
      mockConversation,
    );

    await conversationController.updateConversation(
      mockReq as Request,
      mockRes as Response,
    );

    expect(mockRes.json).toHaveBeenCalledWith(mockConversation);
  });

  it('should return 404 if conversation not found when updating', async () => {
    mockReq.params = { id: '1' };
    mockReq.body = { name: 'Updated Conversation' };
    mockConversationService.updateConversation.mockResolvedValue(null);

    await conversationController.updateConversation(
      mockReq as Request,
      mockRes as Response,
    );

    expect(mockRes.status).toHaveBeenCalledWith(404);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: 'Conversation not found',
    });
  });

  it('should delete a conversation', async () => {
    mockReq.params = { id: '1' };
    mockConversationService.deleteConversation.mockResolvedValue(true);

    await conversationController.deleteConversation(
      mockReq as Request,
      mockRes as Response,
    );

    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith({ success: true });
  });

  it('should return 404 if conversation not found when deleting', async () => {
    mockReq.params = { id: '1' };
    mockConversationService.deleteConversation.mockResolvedValue(false);

    await conversationController.deleteConversation(
      mockReq as Request,
      mockRes as Response,
    );

    expect(mockRes.status).toHaveBeenCalledWith(404);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: 'Conversation not found',
    });
  });

  it('should add a message to a conversation', async () => {
    const mockMessage = {
      id: '1',
      conversationId: '1',
      role: Role.USER,
      content: 'Hello',
      createdAt: new Date(),
    };

    mockReq.params = { id: '1' };
    mockReq.body = { role: Role.USER, content: 'Hello' };
    mockConversationService.addMessageToConversation.mockResolvedValue(
      mockMessage,
    );

    await conversationController.addMessageToConversation(
      mockReq as Request,
      mockRes as Response,
    );

    expect(mockRes.status).toHaveBeenCalledWith(201);
    expect(mockRes.json).toHaveBeenCalledWith(mockMessage);
  });

  it('should return 400 if role or content is missing when adding a message', async () => {
    mockReq.params = { id: '1' };
    mockReq.body = { role: Role.USER };

    await conversationController.addMessageToConversation(
      mockReq as Request,
      mockRes as Response,
    );

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: 'Role and content are required',
    });
  });

  it('should return 400 if role is invalid when adding a message', async () => {
    mockReq.params = { id: '1' };
    mockReq.body = { role: 'invalid', content: 'Hello' };

    await conversationController.addMessageToConversation(
      mockReq as Request,
      mockRes as Response,
    );

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({ error: 'Invalid role' });
  });

  it('should get messages by conversation id', async () => {
    const mockMessages = [
      {
        id: '1',
        conversationId: '1',
        role: Role.USER,
        content: 'Hello',
        createdAt: new Date(),
      },
      {
        id: '2',
        conversationId: '1',
        role: Role.ASSIST,
        content: 'Hi there!',
        createdAt: new Date(),
      },
    ];

    mockReq.params = { id: '1' };
    mockConversationService.getMessagesByConversationId.mockResolvedValue(
      mockMessages,
    );

    await conversationController.getMessagesByConversationId(
      mockReq as Request,
      mockRes as Response,
    );

    expect(mockRes.json).toHaveBeenCalledWith(mockMessages);
  });
});
