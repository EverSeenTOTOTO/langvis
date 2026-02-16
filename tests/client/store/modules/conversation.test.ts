import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationStore } from '@/client/store/modules/conversation';
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

  beforeEach(() => {
    vi.clearAllMocks();
    store = new ConversationStore();
    // Mock the method to prevent reaction from calling unmocked API
    vi.spyOn(store, 'getMessagesByConversationId').mockResolvedValue([]);
  });

  describe('basic getters and setters', () => {
    it('should set and get currentConversationId', () => {
      store.setCurrentConversationId('conv-1');
      expect(store.currentConversationId).toBe('conv-1');
    });

    it('should return current conversation', () => {
      store.conversations = [
        { id: 'conv-1', name: 'Test', createdAt: new Date() } as any,
        { id: 'conv-2', name: 'Test 2', createdAt: new Date() } as any,
      ];
      store.setCurrentConversationId('conv-1');
      expect(store.currentConversation?.id).toBe('conv-1');
    });

    it('should return current messages', () => {
      store.messages = {
        'conv-1': [{ id: 'msg-1', role: Role.USER, content: 'Hello' } as any],
      };
      store.setCurrentConversationId('conv-1');
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
});
