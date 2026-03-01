import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationGroupStore } from '@/client/store/modules/conversationGroup';
import { UNGROUPED_GROUP_NAME } from '@/shared/constants';

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

  describe('sortedGroups', () => {
    it('should place Ungrouped first regardless of order', () => {
      store.groups = [
        { id: 'group-1', name: 'Group A', order: 1 } as any,
        { id: 'group-2', name: UNGROUPED_GROUP_NAME, order: 100 } as any,
        { id: 'group-3', name: 'Group B', order: 0 } as any,
      ];

      const sorted = store.sortedGroups;
      expect(sorted[0].name).toBe(UNGROUPED_GROUP_NAME);
    });

    it('should sort other groups by order', () => {
      store.groups = [
        { id: 'group-1', name: 'Group A', order: 200 } as any,
        { id: 'group-2', name: 'Group B', order: 50 } as any,
        { id: 'group-3', name: 'Group C', order: 100 } as any,
      ];

      const sorted = store.sortedGroups;
      expect(sorted[0].name).toBe('Group B');
      expect(sorted[1].name).toBe('Group C');
      expect(sorted[2].name).toBe('Group A');
    });

    it('should combine Ungrouped first with order sorting', () => {
      store.groups = [
        { id: 'group-1', name: 'Group A', order: 1 } as any,
        { id: 'group-2', name: UNGROUPED_GROUP_NAME, order: 999 } as any,
        { id: 'group-3', name: 'Group B', order: 0 } as any,
        { id: 'group-4', name: 'Group C', order: 2 } as any,
      ];

      const sorted = store.sortedGroups;
      expect(sorted[0].name).toBe(UNGROUPED_GROUP_NAME);
      expect(sorted[1].name).toBe('Group B');
      expect(sorted[2].name).toBe('Group A');
      expect(sorted[3].name).toBe('Group C');
    });

    it('should return empty array when no groups', () => {
      expect(store.sortedGroups).toEqual([]);
    });
  });
});
