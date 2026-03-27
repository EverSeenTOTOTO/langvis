import { ConversationService } from '@/server/service/ConversationService';
import pg from '@/server/service/pg';
import { AgentIds } from '@/shared/constants';
import { Role } from '@/shared/entities/Message';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the pg module
vi.mock('@/server/service/pg', () => ({
  default: {
    getRepository: vi.fn().mockImplementation((entity: any) => {
      if (entity.name === 'ConversationEntity') {
        return {
          create: vi.fn(e => e),
          save: vi.fn(async e => e),
          findOneBy: vi.fn(async () => null),
          findOne: vi.fn(async () => null),
          find: vi.fn(async () => []),
          delete: vi.fn(async () => ({ affected: 0 })),
          createQueryBuilder: vi.fn(() => ({
            where: vi.fn().mockReturnThis(),
            andWhere: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            getRawOne: vi.fn(async () => ({ max: 0 })),
          })),
        };
      } else if (entity.name === 'MessageEntity') {
        return {
          create: vi.fn(e => e),
          save: vi.fn(async e => e),
          findOneBy: vi.fn(async () => null),
          find: vi.fn(async () => []),
          delete: vi.fn(async () => ({ affected: 0 })),
        };
      } else if (entity.name === 'ConversationGroupEntity') {
        return {
          create: vi.fn(e => e),
          save: vi.fn(async e => e),
          findOneBy: vi.fn(async () => null),
          find: vi.fn(async () => []),
          createQueryBuilder: vi.fn(() => ({
            where: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            getRawOne: vi.fn(async () => ({ max: 0 })),
          })),
        };
      }
      return {
        create: vi.fn(e => e),
        save: vi.fn(async e => e),
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

  beforeEach(() => {
    conversationService = new ConversationService(pg as any);
  });

  it('should create a conversation', async () => {
    const mockConversation = {
      id: '1',
      name: 'Test Conversation',
      config: { agent: AgentIds.CHAT },
      createdAt: new Date(),
      messages: [],
      userId: 'test-user-id',
      order: 100,
      groupId: 'ungrouped-group-id',
    };

    const mockGroup = {
      id: 'ungrouped-group-id',
      name: 'ungrouped',
      userId: 'test-user-id',
      order: 0,
    };

    (pg.getRepository as any).mockImplementation((entity: any) => {
      if (entity.name === 'ConversationEntity') {
        return {
          create: vi.fn().mockImplementation(data => {
            expect(data.config).toEqual({ agent: AgentIds.CHAT });
            return mockConversation;
          }),
          save: vi.fn().mockResolvedValue(mockConversation),
          createQueryBuilder: vi.fn(() => ({
            where: vi.fn().mockReturnThis(),
            andWhere: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            getRawOne: vi.fn(async () => ({ max: 0 })),
          })),
        };
      } else if (entity.name === 'ConversationGroupEntity') {
        return {
          findOneBy: vi.fn().mockResolvedValue(mockGroup),
        };
      }
      return {};
    });

    const result = await conversationService.createConversation(
      'Test Conversation',
      'test-user-id',
    );
    expect(result).toEqual(mockConversation);
  });

  it('should create a conversation with config', async () => {
    const mockConversation = {
      id: '1',
      name: 'Test Conversation',
      config: { model: 'gpt-4', temperature: 0.7, agent: AgentIds.CHAT },
      createdAt: new Date(),
      messages: [],
      userId: 'test-user-id',
      order: 100,
      groupId: 'ungrouped-group-id',
    };

    const mockGroup = {
      id: 'ungrouped-group-id',
      name: 'ungrouped',
      userId: 'test-user-id',
      order: 0,
    };

    (pg.getRepository as any).mockImplementation((entity: any) => {
      if (entity.name === 'ConversationEntity') {
        return {
          create: vi.fn().mockImplementation(data => {
            expect(data.config).toEqual({
              model: 'gpt-4',
              temperature: 0.7,
              agent: AgentIds.CHAT,
            });
            return mockConversation;
          }),
          save: vi.fn().mockResolvedValue(mockConversation),
          createQueryBuilder: vi.fn(() => ({
            where: vi.fn().mockReturnThis(),
            andWhere: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            getRawOne: vi.fn(async () => ({ max: 0 })),
          })),
        };
      } else if (entity.name === 'ConversationGroupEntity') {
        return {
          findOneBy: vi.fn().mockResolvedValue(mockGroup),
        };
      }
      return {};
    });

    const result = await conversationService.createConversation(
      'Test Conversation',
      'test-user-id',
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
      'test-user-id',
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
      'test-user-id',
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
      'test-user-id',
    );
    expect(result).toEqual(mockConversation);
  });

  it('should delete a conversation', async () => {
    const deleteMock = vi.fn().mockResolvedValue({ affected: 1 });

    (pg.getRepository as any).mockImplementation((entity: any) => {
      if (entity.name === 'ConversationEntity') {
        return {
          delete: deleteMock,
        };
      }
      return {
        delete: vi.fn().mockResolvedValue({ affected: 0 }),
      };
    });

    const result = await conversationService.deleteConversation(
      '1',
      'test-user-id',
    );
    expect(result).toBe(true);
    expect(deleteMock).toHaveBeenCalledWith({
      id: '1',
      userId: 'test-user-id',
    });
  });

  it('should cascade delete messages when conversation is deleted', async () => {
    // Cascade delete is handled by database (onDelete: 'CASCADE' in entity)
    // This test verifies the delete operation is called correctly
    const deleteMock = vi.fn().mockResolvedValue({ affected: 1 });

    (pg.getRepository as any).mockImplementation((entity: any) => {
      if (entity.name === 'ConversationEntity') {
        return {
          delete: deleteMock,
        };
      }
      return {
        delete: vi.fn().mockResolvedValue({ affected: 0 }),
      };
    });

    const result = await conversationService.deleteConversation(
      '1',
      'test-user-id',
    );
    expect(result).toBe(true);
    expect(deleteMock).toHaveBeenCalledWith({
      id: '1',
      userId: 'test-user-id',
    });
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
        meta: { loading: true },
      },
    ];

    // Mock conversation repository
    (pg.getRepository as any).mockReturnValueOnce({
      findOneBy: vi.fn().mockResolvedValue(mockConversation),
    });

    // Mock message repository
    (pg.getRepository as any).mockReturnValueOnce({
      create: vi.fn().mockImplementation(data => data),
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
      conversationService.batchAddMessages('non-existent', messagesData),
    ).rejects.toThrow('Conversation non-existent not found');
  });

  it('should create a conversation with specific groupId', async () => {
    const mockConversation = {
      id: '1',
      name: 'Test Conversation',
      config: { agent: AgentIds.CHAT },
      createdAt: new Date(),
      messages: [],
      userId: 'test-user-id',
      order: 100,
      groupId: 'specific-group-id',
    };

    const mockGroup = {
      id: 'specific-group-id',
      name: 'Specific Group',
      userId: 'test-user-id',
      order: 0,
    };

    (pg.getRepository as any).mockImplementation((entity: any) => {
      if (entity.name === 'ConversationEntity') {
        return {
          create: vi.fn().mockReturnValue(mockConversation),
          save: vi.fn().mockResolvedValue(mockConversation),
          createQueryBuilder: vi.fn(() => ({
            where: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            getRawOne: vi.fn(async () => ({ max: 0 })),
          })),
        };
      } else if (entity.name === 'ConversationGroupEntity') {
        return {
          findOneBy: vi.fn().mockResolvedValue(mockGroup),
        };
      }
      return {};
    });

    const result = await conversationService.createConversation(
      'Test Conversation',
      'test-user-id',
      {},
      'specific-group-id',
    );
    expect(result).toEqual(mockConversation);
    expect(result.groupId).toBe('specific-group-id');
  });

  it('should create a conversation with groupName and find existing group', async () => {
    const mockConversation = {
      id: '1',
      name: 'Test Conversation',
      config: { agent: AgentIds.CHAT },
      createdAt: new Date(),
      messages: [],
      userId: 'test-user-id',
      order: 100,
      groupId: 'existing-group-id',
    };

    const mockGroup = {
      id: 'existing-group-id',
      name: 'My Group',
      userId: 'test-user-id',
      order: 100,
    };

    (pg.getRepository as any).mockImplementation((entity: any) => {
      if (entity.name === 'ConversationEntity') {
        return {
          create: vi.fn().mockReturnValue(mockConversation),
          save: vi.fn().mockResolvedValue(mockConversation),
          createQueryBuilder: vi.fn(() => ({
            where: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            getRawOne: vi.fn(async () => ({ max: 0 })),
          })),
        };
      } else if (entity.name === 'ConversationGroupEntity') {
        return {
          findOneBy: vi.fn().mockImplementation(async (criteria: any) => {
            if (criteria.name === 'My Group') return mockGroup;
            if (criteria.id === 'existing-group-id') return mockGroup;
            return null;
          }),
        };
      }
      return {};
    });

    const result = await conversationService.createConversation(
      'Test Conversation',
      'test-user-id',
      {},
      null,
      'My Group',
    );
    expect(result).toEqual(mockConversation);
    expect(result.groupId).toBe('existing-group-id');
  });

  it('should create a conversation with groupName and create new group if not found', async () => {
    const mockConversation = {
      id: '1',
      name: 'Test Conversation',
      config: { agent: AgentIds.CHAT },
      createdAt: new Date(),
      messages: [],
      userId: 'test-user-id',
      order: 100,
      groupId: 'new-group-id',
    };

    const newGroup = {
      id: 'new-group-id',
      name: 'New Group',
      userId: 'test-user-id',
      order: 100,
    };

    (pg.getRepository as any).mockImplementation((entity: any) => {
      if (entity.name === 'ConversationEntity') {
        return {
          create: vi.fn().mockReturnValue(mockConversation),
          save: vi.fn().mockResolvedValue(mockConversation),
          createQueryBuilder: vi.fn(() => ({
            where: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            getRawOne: vi.fn(async () => ({ max: 0 })),
          })),
        };
      } else if (entity.name === 'ConversationGroupEntity') {
        return {
          // Return null for name search, but return group for id search
          findOneBy: vi.fn().mockImplementation(async (criteria: any) => {
            if (criteria.name) return null; // Group name not found
            if (criteria.id === 'new-group-id') return newGroup; // Verify by id
            return null;
          }),
          create: vi.fn().mockReturnValue(newGroup),
          save: vi.fn().mockResolvedValue(newGroup),
          createQueryBuilder: vi.fn(() => ({
            where: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            getRawOne: vi.fn(async () => ({ max: 0 })),
          })),
        };
      }
      return {};
    });

    const result = await conversationService.createConversation(
      'Test Conversation',
      'test-user-id',
      {},
      null,
      'New Group',
    );
    expect(result).toEqual(mockConversation);
    expect(result.groupId).toBe('new-group-id');
  });

  it('should create ungrouped group when no groupId provided', async () => {
    const mockConversation = {
      id: '1',
      name: 'Test Conversation',
      config: { agent: AgentIds.CHAT },
      createdAt: new Date(),
      messages: [],
      userId: 'test-user-id',
      order: 100,
      groupId: 'ungrouped-id',
    };

    const ungroupedGroup = {
      id: 'ungrouped-id',
      name: 'ungrouped',
      userId: 'test-user-id',
      order: 0,
    };

    (pg.getRepository as any).mockImplementation((entity: any) => {
      if (entity.name === 'ConversationEntity') {
        return {
          create: vi.fn().mockReturnValue(mockConversation),
          save: vi.fn().mockResolvedValue(mockConversation),
          createQueryBuilder: vi.fn(() => ({
            where: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            getRawOne: vi.fn(async () => ({ max: 0 })),
          })),
        };
      } else if (entity.name === 'ConversationGroupEntity') {
        return {
          findOneBy: vi.fn().mockResolvedValue(ungroupedGroup),
        };
      }
      return {};
    });

    const result = await conversationService.createConversation(
      'Test Conversation',
      'test-user-id',
    );
    expect(result).toEqual(mockConversation);
    expect(result.groupId).toBe('ungrouped-id');
  });

  it('should update conversation with null groupId to use ungrouped group', async () => {
    const mockConversation = {
      id: '1',
      name: 'Updated Conversation',
      config: {},
      createdAt: new Date(),
      messages: [],
      groupId: 'old-group-id',
    };

    const ungroupedGroup = {
      id: 'ungrouped-id',
      name: 'Ungrouped',
      userId: 'test-user-id',
      order: 0,
    };

    (pg.getRepository as any).mockImplementation((entity: any) => {
      if (entity.name === 'ConversationEntity') {
        return {
          findOneBy: vi.fn().mockResolvedValue(mockConversation),
          save: vi.fn().mockImplementation(async (data: any) => data),
        };
      } else if (entity.name === 'ConversationGroupEntity') {
        return {
          // Return ungrouped group when searching by name or id
          findOneBy: vi.fn().mockImplementation(async (criteria: any) => {
            if (criteria.name === 'Ungrouped') return ungroupedGroup;
            if (criteria.id === 'ungrouped-id') return ungroupedGroup;
            return null;
          }),
        };
      }
      return {};
    });

    const result = await conversationService.updateConversation(
      '1',
      'Updated Conversation',
      'test-user-id',
      {},
      null, // null groupId should assign to ungrouped
    );
    expect(result?.groupId).toBe('ungrouped-id');
  });
});
