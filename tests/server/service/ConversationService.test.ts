import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConversationService } from '@/server/service/ConversationService';
import { Role } from '@/shared/entities/Message';
import pg from '@/server/service/pg';

// Mock the pg module
vi.mock('@/server/service/pg', () => ({
  default: {
    getRepository: vi.fn().mockImplementation((entity: any) => {
      if (entity.name === 'ConversationEntity') {
        return {
          create: vi.fn(entity => entity),
          save: vi.fn(async entity => entity),
          findOneBy: vi.fn(async () => null),
          findOne: vi.fn(async () => null),
          find: vi.fn(async () => []),
          delete: vi.fn(async () => ({ affected: 0 })),
        };
      } else if (entity.name === 'MessageEntity') {
        return {
          create: vi.fn(entity => entity),
          save: vi.fn(async entity => entity),
          findOneBy: vi.fn(async () => null),
          find: vi.fn(async () => []),
          delete: vi.fn(async () => ({ affected: 0 })),
        };
      }
      return {
        create: vi.fn(entity => entity),
        save: vi.fn(async entity => entity),
        findOneBy: vi.fn(async () => null),
        find: vi.fn(async () => []),
        delete: vi.fn(async () => ({ affected: 0 })),
      };
    }),
    isInitialized: true,
  },
}));

describe('ConversationService', () => {
  let conversationService: ConversationService;
  const mockSSEService = {
    sendToConversation: vi.fn(),
    sendToConnection: vi.fn(),
    initSSEConnection: vi.fn(),
    closeSSEConnection: vi.fn(),
  };

  beforeEach(() => {
    conversationService = new ConversationService(mockSSEService as any);
  });

  it('should create a conversation', async () => {
    const mockConversation = {
      id: '1',
      name: 'Test Conversation',
      config: { agent: 'ReAct Agent' },
      createdAt: new Date(),
      messages: [],
    };

    (pg.getRepository as any).mockReturnValue({
      create: vi.fn().mockImplementation(entity => {
        expect(entity.config).toEqual({ agent: 'ReAct Agent' });
        return mockConversation;
      }),
      save: vi.fn().mockResolvedValue(mockConversation),
    });

    const result =
      await conversationService.createConversation('Test Conversation');
    expect(result).toEqual(mockConversation);
  });

  it('should create a conversation with config', async () => {
    const mockConversation = {
      id: '1',
      name: 'Test Conversation',
      config: { model: 'gpt-4', temperature: 0.7, agent: 'ReAct Agent' },
      createdAt: new Date(),
      messages: [],
    };

    (pg.getRepository as any).mockReturnValue({
      create: vi.fn().mockImplementation(entity => {
        expect(entity.config).toEqual({
          model: 'gpt-4',
          temperature: 0.7,
          agent: 'ReAct Agent',
        });
        return mockConversation;
      }),
      save: vi.fn().mockResolvedValue(mockConversation),
    });

    const result = await conversationService.createConversation(
      'Test Conversation',
      { model: 'gpt-4', temperature: 0.7 },
    );
    expect(result).toEqual(mockConversation);
  });

  it('should get a conversation by id', async () => {
    const mockConversation = {
      id: '1',
      name: 'Test Conversation',
      createdAt: new Date(),
      messages: [],
    };

    (pg.getRepository as any).mockReturnValue({
      findOneBy: vi.fn().mockResolvedValue(mockConversation),
    });

    const result = await conversationService.getConversationById('1');
    expect(result).toEqual(mockConversation);
  });

  it('should get all conversations', async () => {
    const mockConversations = [
      {
        id: '1',
        name: 'Test Conversation 1',
        createdAt: new Date(),
        messages: [],
      },
      {
        id: '2',
        name: 'Test Conversation 2',
        createdAt: new Date(),
        messages: [],
      },
    ];

    (pg.getRepository as any).mockReturnValue({
      find: vi.fn().mockResolvedValue(mockConversations),
    });

    const result = await conversationService.getAllConversations();
    expect(result).toEqual(mockConversations);
  });

  it('should update a conversation', async () => {
    const mockConversation = {
      id: '1',
      name: 'Updated Conversation',
      config: null,
      createdAt: new Date(),
      messages: [],
    };

    (pg.getRepository as any).mockReturnValue({
      findOneBy: vi.fn().mockResolvedValue(mockConversation),
      save: vi.fn().mockResolvedValue(mockConversation),
    });

    const result = await conversationService.updateConversation(
      '1',
      'Updated Conversation',
    );
    expect(result).toEqual(mockConversation);
  });

  it('should update a conversation with config', async () => {
    const mockConversation = {
      id: '1',
      name: 'Updated Conversation',
      config: { model: 'gpt-4', temperature: 0.7 },
      createdAt: new Date(),
      messages: [],
    };

    (pg.getRepository as any).mockReturnValue({
      findOneBy: vi.fn().mockResolvedValue(mockConversation),
      save: vi.fn().mockResolvedValue(mockConversation),
    });

    const result = await conversationService.updateConversation(
      '1',
      'Updated Conversation',
      { model: 'gpt-4', temperature: 0.7 },
    );
    expect(result).toEqual(mockConversation);
  });

  it('should update a conversation without changing config when not provided', async () => {
    const mockConversation = {
      id: '1',
      name: 'Updated Conversation',
      config: { model: 'gpt-3.5', temperature: 0.5 },
      createdAt: new Date(),
      messages: [],
    };

    (pg.getRepository as any).mockReturnValue({
      findOneBy: vi.fn().mockResolvedValue(mockConversation),
      save: vi.fn().mockImplementation(entity => {
        expect(entity.name).toBe('Updated Conversation');
        // When updating without providing new config, the existing config should remain unchanged
        expect(entity.config).toEqual({ model: 'gpt-3.5', temperature: 0.5 });
        return mockConversation;
      }),
    });

    const result = await conversationService.updateConversation(
      '1',
      'Updated Conversation',
    );
    expect(result).toEqual(mockConversation);
  });

  it('should delete a conversation', async () => {
    const mockConversation = {
      id: '1',
      name: 'Test Conversation',
      createdAt: new Date(),
      messages: [],
    };

    const findOneMock = vi.fn().mockImplementation(async options => {
      if (options.where && options.where.id === '1') {
        return mockConversation;
      }
      return null;
    });

    const deleteMock = vi.fn().mockResolvedValue({ affected: 1 });

    (pg.getRepository as any).mockImplementation((entity: any) => {
      if (entity.name === 'ConversationEntity') {
        return {
          findOne: findOneMock,
          delete: deleteMock,
        };
      } else if (entity.name === 'MessageEntity') {
        return {
          delete: vi.fn().mockResolvedValue({ affected: 0 }),
        };
      }
      return {
        findOne: vi.fn().mockResolvedValue(null),
        delete: vi.fn().mockResolvedValue({ affected: 0 }),
      };
    });

    const result = await conversationService.deleteConversation('1');
    expect(result).toBe(true);
    expect(findOneMock).toHaveBeenCalledWith({
      where: { id: '1' },
      relations: ['messages'],
    });
    expect(deleteMock).toHaveBeenCalledWith('1');
  });

  it('should cascade delete messages when conversation is deleted', async () => {
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

    const mockConversation = {
      id: '1',
      name: 'Test Conversation',
      createdAt: new Date(),
      messages: mockMessages,
    };

    const findOneMock = vi.fn().mockImplementation(async options => {
      if (options.where && options.where.id === '1') {
        return mockConversation;
      }
      return null;
    });

    const deleteMock = vi.fn().mockResolvedValue({ affected: 1 });
    const messageDeleteMock = vi
      .fn()
      .mockResolvedValue({ affected: mockMessages.length });

    (pg.getRepository as any).mockImplementation((entity: any) => {
      if (entity.name === 'ConversationEntity') {
        return {
          findOne: findOneMock,
          delete: deleteMock,
        };
      } else if (entity.name === 'MessageEntity') {
        return {
          delete: messageDeleteMock,
        };
      }
      return {
        findOne: vi.fn().mockResolvedValue(null),
        delete: vi.fn().mockResolvedValue({ affected: 0 }),
      };
    });

    const result = await conversationService.deleteConversation('1');
    expect(result).toBe(true);
    expect(findOneMock).toHaveBeenCalledWith({
      where: { id: '1' },
      relations: ['messages'],
    });
    expect(messageDeleteMock).toHaveBeenCalledWith({
      conversationId: '1',
    });
    expect(deleteMock).toHaveBeenCalledWith('1');
  });

  it('should add a message to a conversation', async () => {
    const mockConversation = {
      id: '1',
      name: 'Test Conversation',
      createdAt: new Date(),
      messages: [],
    };

    const mockMessage = {
      id: '1',
      conversationId: '1',
      role: Role.USER,
      content: 'Hello',
      createdAt: new Date(),
    };

    // Mock conversation repository
    (pg.getRepository as any).mockReturnValueOnce({
      findOneBy: vi.fn().mockResolvedValue(mockConversation),
    });

    // Mock message repository
    (pg.getRepository as any).mockReturnValueOnce({
      create: vi.fn().mockReturnValue(mockMessage),
      save: vi.fn().mockResolvedValue(mockMessage),
    });

    const result = await conversationService.addMessageToConversation(
      '1',
      Role.USER,
      'Hello',
    );
    expect(result).toEqual(mockMessage);
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

    (pg.getRepository as any).mockReturnValue({
      find: vi.fn().mockResolvedValue(mockMessages),
    });

    const result = await conversationService.getMessagesByConversationId('1');
    expect(result).toEqual(mockMessages);
  });

  it('should update a message', async () => {
    const mockMessage = {
      id: '1',
      conversationId: '1',
      role: Role.ASSIST,
      content: 'Hello world',
      createdAt: new Date(),
    };

    // Mock message repository
    (pg.getRepository as any).mockReturnValueOnce({
      findOneBy: vi.fn().mockResolvedValue(mockMessage),
      save: vi.fn().mockResolvedValue(mockMessage),
    });

    const result = await conversationService.updateMessage(
      '1',
      'Hello world updated',
    );
    expect(result).toEqual(mockMessage);
  });

  it('should return null when updating a non-existent message', async () => {
    // Mock message repository
    (pg.getRepository as any).mockReturnValueOnce({
      findOneBy: vi.fn().mockResolvedValue(null),
    });

    const result = await conversationService.updateMessage(
      'non-existent-id',
      'Hello world',
    );
    expect(result).toBeNull();
  });

  it('should batch add messages to a conversation', async () => {
    const mockConversation = { id: '1', name: 'Test Conversation' };
    const messagesData = [
      { role: Role.USER, content: 'Hello' },
      { role: Role.ASSIST, content: '', meta: { loading: true } },
    ];
    const expectedMessages = [
      { id: '1', conversationId: '1', role: Role.USER, content: 'Hello' },
      { 
        id: '2', 
        conversationId: '1', 
        role: Role.ASSIST, 
        content: '', 
        meta: { loading: true } 
      },
    ];

    // Mock conversation repository
    (pg.getRepository as any).mockReturnValueOnce({
      findOneBy: vi.fn().mockResolvedValue(mockConversation),
    });

    // Mock message repository
    (pg.getRepository as any).mockReturnValueOnce({
      create: vi.fn().mockImplementation((data) => data),
      save: vi.fn().mockResolvedValue(expectedMessages),
    });

    const result = await conversationService.batchAddMessages(
      '1',
      messagesData,
    );
    
    expect(result).toEqual(expectedMessages);
  });

  it('should throw error when batch adding messages to non-existent conversation', async () => {
    const messagesData = [{ role: Role.USER, content: 'Hello' }];

    // Mock conversation repository to return null
    (pg.getRepository as any).mockReturnValueOnce({
      findOneBy: vi.fn().mockResolvedValue(null),
    });

    await expect(
      conversationService.batchAddMessages('non-existent', messagesData)
    ).rejects.toThrow('Conversation non-existent not found');
  });
});
