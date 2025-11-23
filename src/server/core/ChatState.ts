import { Message } from '@/shared/entities/Message';

export type ChatMessage = Pick<Message, 'role' | 'content' | 'id' | 'meta'>;

export interface ChatStateNode {
  messageIndex: number;
  next: ChatStateNode | null;
}

export class ChatState {
  private _head: ChatStateNode | null = null;
  private _current: ChatStateNode | null = null;
  private _messages: ChatMessage[] = [];
  private readonly _conversationId: string;

  constructor(conversationId: string, initialMessages: ChatMessage[] = []) {
    this._conversationId = conversationId;
    this._messages = [...initialMessages];

    // Create state nodes for each message
    if (initialMessages.length > 0) {
      // Create nodes for each message
      for (let i = 0; i < initialMessages.length; i++) {
        const node: ChatStateNode = {
          messageIndex: i,
          next: null,
        };

        if (i === 0) {
          this._head = node;
          this._current = node;
        } else {
          this._current!.next = node;
          this._current = node;
        }
      }
    }
  }

  get conversationId(): string {
    return this._conversationId;
  }

  get currentNode(): ChatStateNode | null {
    return this._current;
  }

  get messages(): readonly ChatMessage[] {
    return this._messages;
  }

  get currentMessage(): ChatMessage | null {
    if (!this._current || this._current.messageIndex >= this._messages.length) {
      return null;
    }
    return this._messages[this._current.messageIndex];
  }

  /**
   * Add a new message and create a new state node
   */
  addMessage(message: ChatMessage): ChatStateNode {
    // Create new messages array with the added message
    this._messages.push(message);

    // Create new node pointing to the last message
    const newNode: ChatStateNode = {
      messageIndex: this._messages.length - 1,
      next: null,
    };

    // Link the new node
    if (this._current) {
      // Remove any existing next nodes (for branching scenarios)
      this._current.next = newNode;
    } else {
      // First node
      this._head = newNode;
    }

    this._current = newNode;

    return newNode;
  }

  /**
   * Update the content of the last message (for streaming scenarios)
   */
  updateCurrentMessage(content: string): boolean {
    if (!this._current || this._messages.length === 0) {
      return false;
    }

    const messageIndex = this._current.messageIndex;
    const currentMessage = this._messages[messageIndex];

    if (!currentMessage) {
      return false;
    }

    // Update message in place
    this._messages[messageIndex] = {
      ...currentMessage,
      content,
    };

    return true;
  }

  /**
   * Pop the current state node and rollback to the previous one
   */
  pop(): ChatStateNode | null {
    if (!this._current) {
      return null;
    }

    // Check if current is the head node
    if (this._current === this._head) {
      return null; // Can't pop the head node
    }

    // Find the previous node
    const previousNode = this._findPreviousNode(this._current);

    if (!previousNode) {
      return null; // Shouldn't happen, but safety check
    }

    return this.timeTravel(previousNode.messageIndex) ? previousNode : null;
  }

  /**
   * Time travel to a specific message by index
   */
  timeTravel(messageIndex: number) {
    if (messageIndex < 0 || messageIndex >= this._messages.length) {
      return false;
    }

    // Find the node that corresponds to this message index
    const targetNode = this._findNodeByMessageIndex(messageIndex);
    if (!targetNode) {
      return false;
    }

    // Truncate messages to the target state
    this._messages = this._messages.slice(0, targetNode.messageIndex + 1);

    // Remove future nodes by setting next to null
    targetNode.next = null;

    // Update current pointer
    this._current = targetNode;

    return true;
  }

  /**
   * Time travel to a specific message by message ID
   */
  timeTravelToMessageId(messageId: string): boolean {
    const messageIndex = this._messages.findIndex(msg => msg.id === messageId);
    if (messageIndex === -1) {
      return false;
    }

    return true;
  }

  /**
   * Get newly added messages between a node and its previous node
   */
  getNewMessagesForNode(node: ChatStateNode): readonly ChatMessage[] {
    const previousNode = this._findPreviousNode(node);
    const startIndex = previousNode ? previousNode.messageIndex + 1 : 0;
    const endIndex = node.messageIndex + 1;

    return this._messages.slice(startIndex, endIndex);
  }

  /**
   * Get all nodes in chronological order
   */
  getAllNodes(): ChatStateNode[] {
    const nodes: ChatStateNode[] = [];
    let current = this._head;

    while (current) {
      nodes.push(current);
      current = current.next;
    }

    return nodes;
  }

  private _findNodeByMessageIndex(messageIndex: number): ChatStateNode | null {
    let current = this._head;

    // First try to find exact match
    while (current) {
      if (current.messageIndex === messageIndex) {
        return current;
      }
      current = current.next;
    }

    // If no exact match, find the node with the highest messageIndex that is <= target messageIndex
    current = this._head;
    let bestNode: ChatStateNode | null = null;

    while (current) {
      if (current.messageIndex <= messageIndex) {
        if (!bestNode || current.messageIndex > bestNode.messageIndex) {
          bestNode = current;
        }
      }
      current = current.next;
    }

    return bestNode;
  }

  private _findPreviousNode(targetNode: ChatStateNode): ChatStateNode | null {
    if (this._head === targetNode) {
      return null; // No previous node for head
    }

    let current = this._head;
    while (current && current.next !== targetNode) {
      current = current.next;
    }

    return current;
  }
}
