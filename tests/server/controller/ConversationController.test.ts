import { describe, it, expect, beforeEach, vi } from 'vitest';
import ConversationController from '@/server/controller/ConversationController';
import { Role } from '@/shared/entities/Message';
import type { Request, Response } from 'express';

describe('ConversationController', () => {
  let conversationController: ConversationController;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  const mockConvRepo = {
    create: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
  const mockMessageRepo = {
    batchCreate: vi.fn(),
    findByConversationId: vi.fn(),
    batchDeleteInConversation: vi.fn(),
  };
  const mockProviderService = {
    getModel: vi.fn(),
  };

  beforeEach(() => {
    conversationController = new ConversationController(
      mockConvRepo as any,
      mockMessageRepo as any,
      mockProviderService as any,
    );
    mockReq = {
      user: { id: 'test-user-id' },
    };
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
      config: null,
      createdAt: new Date(),
    };

    mockReq.body = { name: 'Test Conversation' };
    mockConvRepo.create.mockResolvedValue(mockConversation);

    await conversationController.createConversation(
      mockReq.body,
      mockReq as Request,
      mockRes as Response,
    );

    expect(mockRes.status).toHaveBeenCalledWith(201);
    expect(mockRes.json).toHaveBeenCalledWith(mockConversation);
  });

  it('should create a conversation with config', async () => {
    const mockConversation = {
      id: '1',
      name: 'Test Conversation',
      config: { model: 'gpt-4', temperature: 0.7 },
      createdAt: new Date(),
    };

    mockReq.body = {
      name: 'Test Conversation',
      config: { model: 'gpt-4', temperature: 0.7 },
    };
    mockConvRepo.create.mockResolvedValue(mockConversation);

    await conversationController.createConversation(
      mockReq.body,
      mockReq as Request,
      mockRes as Response,
    );

    expect(mockConvRepo.create).toHaveBeenCalledWith(
      'Test Conversation',
      'test-user-id',
      { model: 'gpt-4', temperature: 0.7 },
      undefined,
      undefined,
    );
    expect(mockRes.status).toHaveBeenCalledWith(201);
    expect(mockRes.json).toHaveBeenCalledWith(mockConversation);
  });

  it('should return 401 if user not authenticated when creating a conversation', async () => {
    mockReq.user = undefined;
    mockReq.body = { name: 'Test Conversation' };

    await conversationController.createConversation(
      mockReq.body,
      mockReq as Request,
      mockRes as Response,
    );

    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
  });

  it('should create a conversation with extra config fields preserved', async () => {
    const mockConversation = {
      id: '1',
      name: 'Test Conversation',
      config: { agent: 'gpt-4', extra: 'field' },
      createdAt: new Date(),
    };

    mockReq.body = {
      name: 'Test Conversation',
      config: { agent: 'gpt-4', extra: 'field' },
    };
    mockConvRepo.create.mockResolvedValue(mockConversation);

    const { CreateConversationRequestDto } = await import(
      '@/shared/dto/controller'
    );

    const validatedBody = await CreateConversationRequestDto.validate(
      mockReq.body,
    );

    await conversationController.createConversation(
      validatedBody,
      mockReq as Request,
      mockRes as Response,
    );

    expect(mockConvRepo.create).toHaveBeenCalledWith(
      'Test Conversation',
      'test-user-id',
      { agent: 'gpt-4', extra: 'field' },
      undefined,
      undefined,
    );
    expect(mockRes.status).toHaveBeenCalledWith(201);
    expect(mockRes.json).toHaveBeenCalledWith(mockConversation);
  });

  it('should return 400 if name is missing when creating a conversation', async () => {
    mockReq.body = {};

    const { CreateConversationRequestDto } = await import(
      '@/shared/dto/controller'
    );

    try {
      await CreateConversationRequestDto.validate(mockReq.body);
      throw new Error('Should have thrown validation error');
    } catch (error: any) {
      expect(error.name).toBe('ValidationException');
      expect(error.errors).toBeDefined();
      expect(error.errors).toContain('name');
    }
  });

  it('should get a conversation by id', async () => {
    const mockConversation = {
      id: '1',
      name: 'Test Conversation',
      createdAt: new Date(),
    };

    mockReq.params = { id: '1' };
    mockConvRepo.findById.mockResolvedValue(mockConversation);

    await conversationController.getConversationById(
      '1',
      mockReq as Request,
      mockRes as Response,
    );

    expect(mockRes.json).toHaveBeenCalledWith(mockConversation);
  });

  it('should return 404 if conversation not found when getting by id', async () => {
    mockReq.params = { id: '1' };
    mockConvRepo.findById.mockResolvedValue(null);

    await conversationController.getConversationById(
      '1',
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
      config: null,
      createdAt: new Date(),
    };

    mockReq.params = { id: '1' };
    mockReq.body = { name: 'Updated Conversation' };
    mockConvRepo.update.mockResolvedValue(mockConversation);

    await conversationController.updateConversation(
      '1',
      mockReq.body,
      mockReq as Request,
      mockRes as Response,
    );

    expect(mockRes.json).toHaveBeenCalledWith(mockConversation);
  });

  it('should update a conversation with config', async () => {
    const mockConversation = {
      id: '1',
      name: 'Updated Conversation',
      config: { model: 'gpt-4', temperature: 0.7 },
      createdAt: new Date(),
    };

    mockReq.params = { id: '1' };
    mockReq.body = {
      name: 'Updated Conversation',
      config: { model: 'gpt-4', temperature: 0.7 },
    };
    mockConvRepo.update.mockResolvedValue(mockConversation);

    await conversationController.updateConversation(
      '1',
      mockReq.body,
      mockReq as Request,
      mockRes as Response,
    );

    expect(mockConvRepo.update).toHaveBeenCalledWith(
      '1',
      'Updated Conversation',
      'test-user-id',
      { model: 'gpt-4', temperature: 0.7 },
      undefined,
      undefined,
    );
    expect(mockRes.json).toHaveBeenCalledWith(mockConversation);
  });

  it('should return 404 if conversation not found when updating', async () => {
    mockReq.params = { id: '1' };
    mockReq.body = { name: 'Updated Conversation' };
    mockConvRepo.update.mockResolvedValue(null);

    await conversationController.updateConversation(
      '1',
      mockReq.body,
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
    mockConvRepo.delete.mockResolvedValue(true);

    await conversationController.deleteConversation(
      '1',
      mockReq as Request,
      mockRes as Response,
    );

    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith({ success: true });
  });

  it('should return 404 if conversation not found when deleting', async () => {
    mockReq.params = { id: '1' };
    mockConvRepo.delete.mockResolvedValue(false);

    await conversationController.deleteConversation(
      '1',
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
    mockMessageRepo.batchCreate.mockResolvedValue([mockMessage]);

    await conversationController.addMessageToConversation(
      '1',
      mockReq.body,
      mockRes as Response,
    );

    expect(mockRes.status).toHaveBeenCalledWith(201);
    expect(mockRes.json).toHaveBeenCalledWith([mockMessage]);
  });

  it('should return 400 if role or content is missing when adding a message', async () => {
    mockReq.params = { id: '1' };
    mockReq.body = { role: Role.USER };

    const { AddMessageToConversationRequestDto } = await import(
      '@/shared/dto/controller'
    );

    try {
      await AddMessageToConversationRequestDto.validate(mockReq.body);
      throw new Error('Should have thrown validation error');
    } catch (error: any) {
      expect(error.name).toBe('ValidationException');
      expect(error.errors).toBeDefined();
      expect(error.errors).toContain('content');
    }
  });

  it('should return 400 if role is invalid when adding a message', async () => {
    mockReq.params = { id: '1' };
    mockReq.body = { role: 'invalid', content: 'Hello' };

    const { AddMessageToConversationRequestDto } = await import(
      '@/shared/dto/controller'
    );

    try {
      await AddMessageToConversationRequestDto.validate(mockReq.body);
      throw new Error('Should have thrown validation error');
    } catch (error: any) {
      expect(error.name).toBe('ValidationException');
      expect(error.errors).toBeDefined();
      expect(error.errors).toContain('role');
    }
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
    mockMessageRepo.findByConversationId.mockResolvedValue(mockMessages);
    mockConvRepo.findById.mockResolvedValue({
      id: '1',
      config: { model: { modelId: 'openai:gpt-4' } },
    });
    mockProviderService.getModel.mockReturnValue({ contextSize: 8192 });

    await conversationController.getMessagesByConversationId(
      '1',
      mockRes as Response,
    );

    expect(mockRes.json).toHaveBeenCalledWith({
      messages: mockMessages,
      contextUsage: { used: expect.any(Number), total: 8192 },
    });
  });
});
