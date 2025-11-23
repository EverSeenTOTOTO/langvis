import { ChatState, type ChatMessage } from '@/server/core/ChatState';
import { Role } from '@/shared/entities/Message';
import { beforeEach, describe, expect, it } from 'vitest';

describe('ChatState', () => {
  let chatState: ChatState;
  const conversationId = 'test-conversation-id';

  const createTestMessage = (
    id: string,
    role: Role,
    content: string,
  ): ChatMessage => ({
    id,
    role,
    content,
    meta: null,
  });

  beforeEach(() => {
    chatState = new ChatState(conversationId);
  });

  describe('constructor', () => {
    it('should initialize with empty state', () => {
      expect(chatState.conversationId).toBe(conversationId);
      expect(chatState.messages).toEqual([]);
      expect(chatState.currentNode).toBe(null);
      expect(chatState.currentMessage).toBe(null);
    });

    it('should initialize with initial messages', () => {
      const initialMessages = [
        createTestMessage('1', Role.USER, 'Hello'),
        createTestMessage('2', Role.ASSIST, 'Hi there'),
      ];
      const chatStateWithMessages = new ChatState(
        conversationId,
        initialMessages,
      );

      expect(chatStateWithMessages.messages).toEqual(initialMessages);
      expect(chatStateWithMessages.currentNode).not.toBe(null);
      expect(chatStateWithMessages.currentNode!.messageIndex).toBe(1);
      expect(chatStateWithMessages.currentMessage).toEqual(initialMessages[1]);
    });

    it('should properly link nodes for initial messages', () => {
      const initialMessages = [
        createTestMessage('1', Role.USER, 'First'),
        createTestMessage('2', Role.ASSIST, 'Second'),
        createTestMessage('3', Role.USER, 'Third'),
      ];
      const chatStateWithMessages = new ChatState(
        conversationId,
        initialMessages,
      );

      const nodes = chatStateWithMessages.getAllNodes();
      expect(nodes).toHaveLength(3);
      expect(nodes[0].messageIndex).toBe(0);
      expect(nodes[1].messageIndex).toBe(1);
      expect(nodes[2].messageIndex).toBe(2);
      expect(nodes[0].next).toBe(nodes[1]);
      expect(nodes[1].next).toBe(nodes[2]);
      expect(nodes[2].next).toBe(null);
    });
  });

  describe('addMessage', () => {
    it('should add first message and create head node', () => {
      const message = createTestMessage('1', Role.USER, 'Hello');
      const node = chatState.addMessage(message);

      expect(chatState.messages).toEqual([message]);
      expect(chatState.currentNode).toBe(node);
      expect(node.messageIndex).toBe(0);
      expect(node.next).toBe(null);
      expect(chatState.currentMessage).toEqual(message);
    });

    it('should add subsequent messages and link nodes', () => {
      const message1 = createTestMessage('1', Role.USER, 'Hello');
      const message2 = createTestMessage('2', Role.ASSIST, 'Hi');

      const node1 = chatState.addMessage(message1);
      const node2 = chatState.addMessage(message2);

      expect(chatState.messages).toEqual([message1, message2]);
      expect(chatState.currentNode).toBe(node2);
      expect(node1.next).toBe(node2);
      expect(node2.next).toBe(null);
      expect(node1.messageIndex).toBe(0);
      expect(node2.messageIndex).toBe(1);
    });

    it('should replace next node when branching', () => {
      const message1 = createTestMessage('1', Role.USER, 'Hello');
      const message2 = createTestMessage('2', Role.ASSIST, 'Hi');
      const message3 = createTestMessage(
        '3',
        Role.ASSIST,
        'Alternative response',
      );

      chatState.addMessage(message1);
      const node2 = chatState.addMessage(message2);

      // Go back to first message and add alternative
      chatState.timeTravel(0);
      const node3 = chatState.addMessage(message3);

      expect(chatState.messages).toEqual([message1, message3]);
      expect(node3.next).toBe(null);
      expect(node2.next).toBe(null); // Previous branch should be disconnected
    });
  });

  describe('updateCurrentMessage', () => {
    it('should update current message content', () => {
      const message = createTestMessage('1', Role.ASSIST, 'Initial content');
      chatState.addMessage(message);

      const result = chatState.updateCurrentMessage('Updated content');

      expect(result).toBe(true);
      expect(chatState.currentMessage!.content).toBe('Updated content');
      expect(chatState.messages[0].content).toBe('Updated content');
    });

    it('should return false when no current message', () => {
      const result = chatState.updateCurrentMessage('Content');
      expect(result).toBe(false);
    });

    it('should preserve other message properties', () => {
      const message = createTestMessage('1', Role.ASSIST, 'Initial');
      message.meta = { key: 'value' };
      chatState.addMessage(message);

      chatState.updateCurrentMessage('Updated');

      expect(chatState.currentMessage!.id).toBe('1');
      expect(chatState.currentMessage!.role).toBe(Role.ASSIST);
      expect(chatState.currentMessage!.meta).toEqual({ key: 'value' });
    });
  });

  describe('pop', () => {
    it('should return null when no current node', () => {
      const result = chatState.pop();
      expect(result).toBe(null);
    });

    it('should return null when trying to pop head node', () => {
      const message = createTestMessage('1', Role.USER, 'Hello');
      chatState.addMessage(message);

      const result = chatState.pop();
      expect(result).toBe(null);
    });

    it('should pop to previous node', () => {
      const message1 = createTestMessage('1', Role.USER, 'Hello');
      const message2 = createTestMessage('2', Role.ASSIST, 'Hi');
      const message3 = createTestMessage('3', Role.USER, 'Thanks');

      chatState.addMessage(message1);
      const node2 = chatState.addMessage(message2);
      chatState.addMessage(message3);

      const result = chatState.pop();

      expect(result).toBe(node2);
      expect(chatState.currentNode).toBe(node2);
      expect(chatState.messages).toEqual([message1, message2]);
      expect(chatState.currentMessage).toEqual(message2);
    });
  });

  describe('timeTravel', () => {
    beforeEach(() => {
      const messages = [
        createTestMessage('1', Role.USER, 'First'),
        createTestMessage('2', Role.ASSIST, 'Second'),
        createTestMessage('3', Role.USER, 'Third'),
        createTestMessage('4', Role.ASSIST, 'Fourth'),
      ];
      messages.forEach(msg => chatState.addMessage(msg));
    });

    it('should time travel to specific message index', () => {
      const result = chatState.timeTravel(1);

      expect(result).toBe(true);
      expect(chatState.currentNode!.messageIndex).toBe(1);
      expect(chatState.messages).toHaveLength(2);
      expect(chatState.currentMessage!.content).toBe('Second');
    });

    it('should truncate messages and remove future nodes', () => {
      const nodesBefore = chatState.getAllNodes();
      expect(nodesBefore).toHaveLength(4);

      chatState.timeTravel(1);

      const nodesAfter = chatState.getAllNodes();
      expect(nodesAfter).toHaveLength(2);
      expect(nodesAfter[1].next).toBe(null);
    });

    it('should return false for invalid message index', () => {
      expect(chatState.timeTravel(-1)).toBe(false);
      expect(chatState.timeTravel(10)).toBe(false);
    });

    it('should handle time travel to message index 0', () => {
      const result = chatState.timeTravel(0);

      expect(result).toBe(true);
      expect(chatState.messages).toHaveLength(1);
      expect(chatState.currentNode!.messageIndex).toBe(0);
    });
  });

  describe('timeTravelToMessageId', () => {
    beforeEach(() => {
      const messages = [
        createTestMessage('msg1', Role.USER, 'First'),
        createTestMessage('msg2', Role.ASSIST, 'Second'),
        createTestMessage('msg3', Role.USER, 'Third'),
      ];
      messages.forEach(msg => chatState.addMessage(msg));
    });

    it('should find message by ID and return true', () => {
      const result = chatState.timeTravelToMessageId('msg2');
      expect(result).toBe(true);
    });

    it('should return false for non-existent message ID', () => {
      const result = chatState.timeTravelToMessageId('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('getNewMessagesForNode', () => {
    it('should get new messages for node with no previous node', () => {
      const message1 = createTestMessage('1', Role.USER, 'Hello');
      const message2 = createTestMessage('2', Role.ASSIST, 'Hi');

      const node1 = chatState.addMessage(message1);
      chatState.addMessage(message2);

      const newMessages = chatState.getNewMessagesForNode(node1);
      expect(newMessages).toEqual([message1]);
    });

    it('should get new messages between nodes', () => {
      const message2 = createTestMessage('2', Role.ASSIST, 'Second');
      const message3 = createTestMessage('3', Role.USER, 'Third');
      const message4 = createTestMessage('4', Role.ASSIST, 'Fourth');

      chatState.addMessage(message2);
      const node3 = chatState.addMessage(message3);
      chatState.addMessage(message4);

      const newMessages = chatState.getNewMessagesForNode(node3);
      expect(newMessages).toEqual([message3]);
    });

    it('should handle multiple new messages for a node', () => {
      const messages = [
        createTestMessage('1', Role.USER, 'First'),
        createTestMessage('2', Role.ASSIST, 'Second'),
        createTestMessage('3', Role.USER, 'Third'),
        createTestMessage('4', Role.ASSIST, 'Fourth'),
      ];

      chatState.addMessage(messages[1]);
      chatState.addMessage(messages[2]);
      const node4 = chatState.addMessage(messages[3]);

      // Test if we had a longer jump between nodes
      const newMessages = chatState.getNewMessagesForNode(node4);
      expect(newMessages).toEqual([messages[3]]);
    });
  });

  describe('getAllNodes', () => {
    it('should return empty array for empty state', () => {
      const nodes = chatState.getAllNodes();
      expect(nodes).toEqual([]);
    });

    it('should return all nodes in chronological order', () => {
      const messages = [
        createTestMessage('1', Role.USER, 'First'),
        createTestMessage('2', Role.ASSIST, 'Second'),
        createTestMessage('3', Role.USER, 'Third'),
      ];

      const nodes = messages.map(msg => chatState.addMessage(msg));
      const allNodes = chatState.getAllNodes();

      expect(allNodes).toEqual(nodes);
      expect(allNodes).toHaveLength(3);
      expect(allNodes[0].messageIndex).toBe(0);
      expect(allNodes[1].messageIndex).toBe(1);
      expect(allNodes[2].messageIndex).toBe(2);
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle node finding when exact match is not available', () => {
      const messages = [
        createTestMessage('1', Role.USER, 'First'),
        createTestMessage('2', Role.ASSIST, 'Second'),
      ];
      messages.forEach(msg => chatState.addMessage(msg));

      // This should work even though there's no exact node for index 1
      // It should find the best matching node
      const result = chatState.timeTravel(1);
      expect(result).toBe(true);
    });

    it('should maintain state consistency after complex operations', () => {
      // Complex scenario: Add messages, time travel, add more, pop
      const msg1 = createTestMessage('1', Role.USER, 'Hello');
      const msg2 = createTestMessage('2', Role.ASSIST, 'Hi');
      const msg3 = createTestMessage('3', Role.USER, 'Thanks');
      const msg4 = createTestMessage('4', Role.ASSIST, 'Alternative');

      chatState.addMessage(msg1);
      chatState.addMessage(msg2);
      chatState.addMessage(msg3);

      chatState.timeTravel(1); // Go back to msg2
      chatState.addMessage(msg4); // Add alternative response

      expect(chatState.messages).toEqual([msg1, msg2, msg4]);
      expect(chatState.currentMessage).toEqual(msg4);
      expect(chatState.getAllNodes()).toHaveLength(3);
    });
  });
});
