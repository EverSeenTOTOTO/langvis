import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConversationFSM } from '@/client/store/modules/ConversationFSM';
import { Role } from '@/shared/entities/Message';
import type { Message } from '@/shared/types/entities';
import type { AgentEvent } from '@/shared/types';

// Mock EventSource
class MockEventSource {
  url: string;
  readyState: number = EventSource.CONNECTING;
  listeners: Map<string, EventListener[]> = new Map();
  closed = false;

  constructor(url: string) {
    this.url = url;
    setTimeout(() => {
      this.readyState = EventSource.OPEN;
    }, 0);
  }

  addEventListener(type: string, listener: EventListener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  close() {
    this.closed = true;
    this.readyState = EventSource.CLOSED;
  }

  emit(type: string, data: unknown) {
    const listeners = this.listeners.get(type) || [];
    const event = { data: JSON.stringify(data) } as MessageEvent;
    listeners.forEach(l => l(event));
  }

  emitError() {
    const listeners = this.listeners.get('error') || [];
    listeners.forEach(l => l({} as Event));
  }
}

vi.stubGlobal('EventSource', MockEventSource);

describe('ConversationFSM', () => {
  let fsm: ConversationFSM;
  let options: {
    onEvent: ReturnType<typeof vi.fn>;
    onError: ReturnType<typeof vi.fn>;
    onRefreshMessages: ReturnType<typeof vi.fn>;
  };

  const createMessage = (id = 'msg-1'): Message => ({
    id,
    role: Role.ASSIST,
    content: '',
    meta: { events: [] as AgentEvent[] },
    createdAt: new Date(),
    conversationId: 'conv-1',
  });

  beforeEach(() => {
    options = {
      onEvent: vi.fn(),
      onError: vi.fn(),
      onRefreshMessages: vi.fn(),
    };
    fsm = new ConversationFSM('conv-1', options);
  });

  describe('initial state', () => {
    it('should start with idle phase', () => {
      expect(fsm.phase).toBe('idle');
    });

    it('should have correct conversationId', () => {
      expect(fsm.conversationId).toBe('conv-1');
    });

    it('should not have active message initially', () => {
      expect(fsm.hasActiveMessage).toBe(false);
    });

    it('should be able to start chat initially', () => {
      expect(fsm.canStartChat).toBe(true);
    });

    it('should not be connecting initially', () => {
      expect(fsm.isConnecting).toBe(false);
    });
  });

  describe('transition', () => {
    it('should transition from idle to connecting', () => {
      (fsm as any).transition('connecting');
      expect(fsm.phase).toBe('connecting');
    });

    it('should not allow invalid transition from idle to active', () => {
      (fsm as any).transition('active');
      expect(fsm.phase).toBe('idle');
    });

    it('should follow valid transition path: idle→connecting→connected→active', () => {
      (fsm as any).transition('connecting');
      expect(fsm.phase).toBe('connecting');

      (fsm as any).transition('connected');
      expect(fsm.phase).toBe('connected');

      (fsm as any).transition('active');
      expect(fsm.phase).toBe('active');
    });

    it('should allow transition from active to canceling', () => {
      (fsm as any).transition('connecting');
      (fsm as any).transition('connected');
      (fsm as any).transition('active');

      (fsm as any).transition('canceling');
      expect(fsm.phase).toBe('canceling');
    });

    it('should allow transition from canceling to canceled', () => {
      (fsm as any).transition('connecting');
      (fsm as any).transition('connected');
      (fsm as any).transition('active');
      (fsm as any).transition('canceling');

      (fsm as any).transition('canceled');
      expect(fsm.phase).toBe('canceled');
    });

    it('should allow transition from error to canceled', () => {
      (fsm as any).transition('connecting');
      (fsm as any).transition('error');

      (fsm as any).transition('canceled');
      expect(fsm.phase).toBe('canceled');
    });
  });

  describe('addMessageFSM', () => {
    beforeEach(() => {
      (fsm as any).transition('connecting');
      (fsm as any).transition('connected');
    });

    it('should create and store a MessageFSM', () => {
      const message = createMessage('msg-1');
      const msgFsm = fsm.addMessageFSM('msg-1', message);

      expect(msgFsm).toBeDefined();
      expect(msgFsm.messageId).toBe('msg-1');
      expect(fsm.getMessageFSM('msg-1')).toBe(msgFsm);
    });

    it('should reuse existing MessageFSM with setMessage', () => {
      const message1 = createMessage('msg-1');
      const message2 = createMessage('msg-1');

      const msgFsm1 = fsm.addMessageFSM('msg-1', message1);
      const msgFsm2 = fsm.addMessageFSM('msg-1', message2);

      expect(msgFsm2).toBe(msgFsm1);
    });
  });

  describe('removeMessageFSM', () => {
    beforeEach(() => {
      (fsm as any).transition('connecting');
      (fsm as any).transition('connected');
    });

    it('should remove MessageFSM from map', () => {
      const message = createMessage('msg-1');
      fsm.addMessageFSM('msg-1', message);

      fsm.removeMessageFSM('msg-1');

      expect(fsm.getMessageFSM('msg-1')).toBeUndefined();
    });
  });

  describe('deactivate', () => {
    it('should close event source when idle', () => {
      const closeSpy = vi.spyOn(fsm as any, 'closeEventSource');

      fsm.deactivate();

      expect(closeSpy).toHaveBeenCalled();
    });

    it('should transition to canceled when in connecting phase', () => {
      (fsm as any).transition('connecting');

      fsm.deactivate();

      expect(fsm.phase).toBe('canceled');
    });

    it('should transition to canceled when in active phase', () => {
      (fsm as any).transition('connecting');
      (fsm as any).transition('connected');
      (fsm as any).transition('active');

      fsm.deactivate();

      expect(fsm.phase).toBe('canceled');
    });

    it('should close all MessageFSMs when deactivating from active', () => {
      (fsm as any).transition('connecting');
      (fsm as any).transition('connected');

      const message = createMessage('msg-1');
      const msgFsm = fsm.addMessageFSM('msg-1', message);
      const closeSpy = vi.spyOn(msgFsm, 'close');

      (fsm as any).transition('active');

      fsm.deactivate();

      expect(closeSpy).toHaveBeenCalled();
    });
  });

  describe('cancelConversation', () => {
    beforeEach(() => {
      (fsm as any).transition('connecting');
      (fsm as any).transition('connected');
    });

    it('should do nothing if not active', async () => {
      const sendCancelApi = vi.fn();

      await fsm.cancelConversation(sendCancelApi);

      expect(sendCancelApi).not.toHaveBeenCalled();
      expect(fsm.phase).toBe('connected');
    });

    it('should call cancel on all cancelable MessageFSMs when active', async () => {
      const message = createMessage('msg-1');
      const msgFsm = fsm.addMessageFSM('msg-1', message);
      // Put message in loading state (canCancel is true for loading)
      msgFsm.phase = 'loading';

      (fsm as any).transition('active');

      const sendCancelApi = vi.fn().mockResolvedValue(undefined);
      await fsm.cancelConversation(sendCancelApi);

      expect(fsm.phase).toBe('canceled');
      expect(sendCancelApi).toHaveBeenCalled();
      expect(options.onRefreshMessages).toHaveBeenCalledWith('conv-1');
    });

    it('should transition to canceled on 404 error', async () => {
      const message = createMessage('msg-1');
      const msgFsm = fsm.addMessageFSM('msg-1', message);
      msgFsm.phase = 'loading';

      (fsm as any).transition('active');

      const sendCancelApi = vi
        .fn()
        .mockRejectedValue(new Error('404 Not Found'));
      await fsm.cancelConversation(sendCancelApi);

      expect(fsm.phase).toBe('canceled');
    });

    it('should transition to error on non-404 error', async () => {
      const message = createMessage('msg-1');
      const msgFsm = fsm.addMessageFSM('msg-1', message);
      msgFsm.phase = 'loading';

      (fsm as any).transition('active');

      const sendCancelApi = vi
        .fn()
        .mockRejectedValue(new Error('500 Server Error'));

      await expect(fsm.cancelConversation(sendCancelApi)).rejects.toThrow();

      expect(fsm.phase).toBe('error');
    });
  });

  describe('connected↔active driving', () => {
    beforeEach(() => {
      (fsm as any).transition('connecting');
      (fsm as any).transition('connected');
    });

    it('should transition to active when MessageFSM enters non-terminal state', () => {
      const message = createMessage('msg-1');
      fsm.addMessageFSM('msg-1', message);

      // Trigger phase change by setting loading state
      const msgFsm = fsm.getMessageFSM('msg-1')!;
      msgFsm.phase = 'loading';
      // Manually trigger onMessagePhaseChange
      (fsm as any).onMessagePhaseChange('msg-1', 'loading');

      expect(fsm.phase).toBe('active');
    });

    it('should transition back to connected when all MessageFSMs reach terminal', () => {
      const message = createMessage('msg-1');
      fsm.addMessageFSM('msg-1', message);

      const msgFsm = fsm.getMessageFSM('msg-1')!;
      msgFsm.phase = 'loading';
      (fsm as any).onMessagePhaseChange('msg-1', 'loading');
      expect(fsm.phase).toBe('active');

      msgFsm.phase = 'final';
      (fsm as any).onMessagePhaseChange('msg-1', 'final');
      expect(fsm.phase).toBe('connected');
    });
  });

  describe('computed properties', () => {
    it('hasActiveMessage should be true only in active phase', () => {
      expect(fsm.hasActiveMessage).toBe(false);

      (fsm as any).transition('connecting');
      expect(fsm.hasActiveMessage).toBe(false);

      (fsm as any).transition('connected');
      expect(fsm.hasActiveMessage).toBe(false);

      (fsm as any).transition('active');
      expect(fsm.hasActiveMessage).toBe(true);
    });

    it('canStartChat should be true for idle and connected phases', () => {
      expect(fsm.canStartChat).toBe(true);

      (fsm as any).transition('connecting');
      expect(fsm.canStartChat).toBe(false);

      (fsm as any).transition('connected');
      expect(fsm.canStartChat).toBe(true);

      (fsm as any).transition('active');
      expect(fsm.canStartChat).toBe(false);
    });

    it('isConnecting should be true only in connecting phase', () => {
      expect(fsm.isConnecting).toBe(false);

      (fsm as any).transition('connecting');
      expect(fsm.isConnecting).toBe(true);

      (fsm as any).transition('connected');
      expect(fsm.isConnecting).toBe(false);
    });
  });
});
