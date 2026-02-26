import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationGroupStore } from '@/client/store/modules/conversationGroup';

vi.mock('@/client/decorator/api', () => ({
  api: () => () => {},
  ApiRequest: class {
    send = vi.fn();
  },
}));

vi.mock('@/client/decorator/hydrate', () => ({
  hydrate: () => () => {},
}));

vi.mock('@/client/decorator/store', () => ({
  store: () => (target: any) => target,
}));

describe('ConversationGroupStore', () => {
  let store: ConversationGroupStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new ConversationGroupStore();
  });

  describe('groups management', () => {
    it('should initialize with empty groups', () => {
      expect(store.groups).toEqual([]);
    });
  });

  describe('findGroupIdByConversationId', () => {
    it('should find group id by conversation id', () => {
      store.groups = [
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

      expect(store.findGroupIdByConversationId('conv-1')).toBe('group-1');
      expect(store.findGroupIdByConversationId('conv-2')).toBe('group-1');
      expect(store.findGroupIdByConversationId('conv-3')).toBe('group-2');
    });

    it('should return undefined if conversation not found', () => {
      store.groups = [
        {
          id: 'group-1',
          name: 'Group 1',
          order: 100,
          userId: 'test-user',
          createdAt: new Date(),
          conversations: [],
        },
      ];

      expect(store.findGroupIdByConversationId('non-existent')).toBeUndefined();
    });

    it('should return undefined if groups are empty', () => {
      store.groups = [];
      expect(store.findGroupIdByConversationId('conv-1')).toBeUndefined();
    });
  });
});
