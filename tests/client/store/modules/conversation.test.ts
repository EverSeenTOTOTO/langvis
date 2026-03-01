import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationStore } from '@/client/store/modules/conversation';
import { ConversationGroupStore } from '@/client/store/modules/conversationGroup';
import { UNGROUPED_GROUP_NAME } from '@/shared/constants';
import { Role } from '@/shared/types/entities';

vi.mock('@/client/decorator/api', () => ({
  api: () => () => {},
  ApiRequest: class {},
}));

vi.mock('@/client/decorator/hydrate', () => ({
  hydrate: () => () => {},
}));

vi.mock('@/client/decorator/store', () => ({
  store: () => (target: any) => target,
}));

describe('ConversationStore', () => {
  let store: ConversationStore;
  let groupStore: ConversationGroupStore;

  beforeEach(() => {
    vi.clearAllMocks();
    groupStore = new ConversationGroupStore();
    store = new ConversationStore(groupStore);
    // Mock the method to prevent reaction from calling unmocked API
    vi.spyOn(store, 'getMessagesByConversationId').mockResolvedValue([]);
  });

  describe('basic getters and setters', () => {
    it('should set and get currentConversationId', () => {
      store.currentConversationId = 'conv-1';
      expect(store.currentConversationId).toBe('conv-1');
    });

    it('should return current conversation', () => {
      groupStore.groups = [
        {
          id: 'group-1',
          name: 'Group 1',
          order: 0,
          userId: 'test-user',
          createdAt: new Date(),
          conversations: [
            { id: 'conv-1', name: 'Test', groupId: 'group-1' } as any,
          ],
        },
      ];
      store.currentConversationId = 'conv-1';
      expect(store.currentConversation?.id).toBe('conv-1');
    });

    it('should return current messages', () => {
      store.messages = {
        'conv-1': [{ id: 'msg-1', role: Role.USER, content: 'Hello' } as any],
      };
      store.currentConversationId = 'conv-1';
      expect(store.currentMessages).toHaveLength(1);
    });
  });

  describe('messages management', () => {
    it('should allow direct message access by conversationId', () => {
      const conversationId = 'test-conv-id';
      store.messages[conversationId] = [
        {
          id: 'msg-1',
          role: Role.USER,
          content: 'Hello',
          conversationId,
        } as any,
      ];

      expect(store.messages[conversationId]).toHaveLength(1);
      expect(store.messages[conversationId][0].content).toBe('Hello');
    });

    it('should allow pushing messages to conversation', () => {
      const conversationId = 'test-conv-id';
      store.messages[conversationId] = [];

      store.messages[conversationId].push({
        id: 'msg-1',
        role: Role.USER,
        content: 'Hello',
        conversationId,
      } as any);

      expect(store.messages[conversationId]).toHaveLength(1);
    });
  });

  describe('findConversationById', () => {
    it('should find conversation in a group', () => {
      groupStore.groups = [
        {
          id: 'group-1',
          name: 'Group 1',
          order: 100,
          userId: 'test-user',
          createdAt: new Date(),
          conversations: [
            { id: 'conv-1', name: 'Conv 1', groupId: 'group-1' } as any,
            { id: 'conv-2', name: 'Conv 2', groupId: 'group-1' } as any,
          ],
        },
        {
          id: 'group-2',
          name: 'Group 2',
          order: 200,
          userId: 'test-user',
          createdAt: new Date(),
          conversations: [
            { id: 'conv-3', name: 'Conv 3', groupId: 'group-2' } as any,
          ],
        },
      ];

      expect(store.findConversationById('conv-1')?.name).toBe('Conv 1');
      expect(store.findConversationById('conv-2')?.name).toBe('Conv 2');
      expect(store.findConversationById('conv-3')?.name).toBe('Conv 3');
    });

    it('should return undefined if conversation not found', () => {
      groupStore.groups = [
        {
          id: 'group-1',
          name: 'Group 1',
          order: 100,
          userId: 'test-user',
          createdAt: new Date(),
          conversations: [],
        },
      ];

      expect(store.findConversationById('non-existent')).toBeUndefined();
    });

    it('should return undefined if groups are empty', () => {
      groupStore.groups = [];
      expect(store.findConversationById('conv-1')).toBeUndefined();
    });
  });

  describe('getFirstConversationId', () => {
    it('should return first conversation id from groups', () => {
      groupStore.groups = [
        {
          id: 'group-1',
          name: 'Group 1',
          order: 100,
          userId: 'test-user',
          createdAt: new Date(),
          conversations: [
            { id: 'conv-1', name: 'Conv 1', groupId: 'group-1' } as any,
          ],
        },
      ];

      expect(store.getFirstConversationId()).toBe('conv-1');
    });

    it('should return first conversation from first group with conversations', () => {
      groupStore.groups = [
        {
          id: 'group-1',
          name: 'Empty Group',
          order: 100,
          userId: 'test-user',
          createdAt: new Date(),
          conversations: [],
        },
        {
          id: 'group-2',
          name: 'Group 2',
          order: 200,
          userId: 'test-user',
          createdAt: new Date(),
          conversations: [
            { id: 'conv-1', name: 'Conv 1', groupId: 'group-2' } as any,
          ],
        },
      ];

      expect(store.getFirstConversationId()).toBe('conv-1');
    });

    it('should return undefined if no conversations exist', () => {
      groupStore.groups = [
        {
          id: 'group-1',
          name: 'Empty Group',
          order: 100,
          userId: 'test-user',
          createdAt: new Date(),
          conversations: [],
        },
      ];

      expect(store.getFirstConversationId()).toBeUndefined();
    });

    it('should return undefined if groups are empty', () => {
      groupStore.groups = [];
      expect(store.getFirstConversationId()).toBeUndefined();
    });

    it('should respect group order: Ungrouped first, then by order', () => {
      groupStore.groups = [
        {
          id: 'group-1',
          name: 'Group A',
          order: 1,
          userId: 'test-user',
          createdAt: new Date(),
          conversations: [
            { id: 'conv-a', name: 'Conv A', groupId: 'group-1' } as any,
          ],
        },
        {
          id: 'group-2',
          name: UNGROUPED_GROUP_NAME,
          order: 100,
          userId: 'test-user',
          createdAt: new Date(),
          conversations: [
            {
              id: 'conv-ungrouped',
              name: 'Conv Ungrouped',
              groupId: 'group-2',
            } as any,
          ],
        },
        {
          id: 'group-3',
          name: 'Group B',
          order: 0,
          userId: 'test-user',
          createdAt: new Date(),
          conversations: [
            { id: 'conv-b', name: 'Conv B', groupId: 'group-3' } as any,
          ],
        },
      ];

      // Ungrouped should be first regardless of order value
      expect(store.getFirstConversationId()).toBe('conv-ungrouped');
    });

    it('should sort groups by order when no Ungrouped', () => {
      groupStore.groups = [
        {
          id: 'group-1',
          name: 'Group A',
          order: 200,
          userId: 'test-user',
          createdAt: new Date(),
          conversations: [
            { id: 'conv-a', name: 'Conv A', groupId: 'group-1' } as any,
          ],
        },
        {
          id: 'group-2',
          name: 'Group B',
          order: 50,
          userId: 'test-user',
          createdAt: new Date(),
          conversations: [
            { id: 'conv-b', name: 'Conv B', groupId: 'group-2' } as any,
          ],
        },
      ];

      // Group B has lower order, should be first
      expect(store.getFirstConversationId()).toBe('conv-b');
    });

    it('should sort conversations within group by order', () => {
      groupStore.groups = [
        {
          id: 'group-1',
          name: 'Group 1',
          order: 0,
          userId: 'test-user',
          createdAt: new Date(),
          conversations: [
            {
              id: 'conv-3',
              name: 'Conv 3',
              groupId: 'group-1',
              order: 300,
            } as any,
            {
              id: 'conv-1',
              name: 'Conv 1',
              groupId: 'group-1',
              order: 100,
            } as any,
            {
              id: 'conv-2',
              name: 'Conv 2',
              groupId: 'group-1',
              order: 200,
            } as any,
          ],
        },
      ];

      // Should return conversation with lowest order
      expect(store.getFirstConversationId()).toBe('conv-1');
    });
  });
});
