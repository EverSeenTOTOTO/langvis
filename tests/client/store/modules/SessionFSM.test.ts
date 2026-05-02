import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionFSM } from '@/client/store/modules/SessionFSM';
import { Role } from '@/shared/entities/Message';
import type { Message } from '@/shared/types/entities';
import type { AgentEvent } from '@/shared/types';

// Mock EventSource for SSEClientTransport
class MockEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  url: string;
  readyState: number = MockEventSource.CONNECTING;
  private listeners: Map<string, EventListener[]> = new Map();

  constructor(url: string) {
    this.url = url;
  }

  addEventListener(type: string, listener: EventListener) {
    const list = this.listeners.get(type) || [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  close() {
    this.readyState = MockEventSource.CLOSED;
  }

  emit(type: string, data: unknown) {
    const list = this.listeners.get(type) || [];
    const event = { data: JSON.stringify(data) } as MessageEvent;
    list.forEach(l => l(event));
  }

  emitError() {
    const list = this.listeners.get('error') || [];
    list.forEach(l => l({} as Event));
  }
}

vi.stubGlobal('EventSource', MockEventSource);

describe('SessionFSM', () => {
  let fsm: SessionFSM;
  let onEvent: ReturnType<typeof vi.fn>;

  const createMessage = (id = 'msg-1'): Message => ({
    id,
    role: Role.ASSIST,
    content: '',
    meta: { events: [] as AgentEvent[] },
    createdAt: new Date(),
    conversationId: 'conv-1',
  });

  beforeEach(() => {
    onEvent = vi.fn();

    fsm = new SessionFSM('conv-1');

    fsm.addEventListener('message', e => {
      const event = (e as CustomEvent).detail as AgentEvent;
      onEvent(event);
    });
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
      fsm['sm'].transition('connecting');
      expect(fsm.phase).toBe('connecting');
    });

    it('should not allow invalid transition from idle to active', () => {
      fsm['sm'].transition('active');
      expect(fsm.phase).toBe('idle');
    });

    it('should follow valid transition path: idle→connecting→connected→active', () => {
      fsm['sm'].transition('connecting');
      expect(fsm.phase).toBe('connecting');

      fsm['sm'].transition('connected');
      expect(fsm.phase).toBe('connected');

      fsm['sm'].transition('active');
      expect(fsm.phase).toBe('active');
    });

    it('should allow transition from active to canceling', () => {
      fsm['sm'].transition('connecting');
      fsm['sm'].transition('connected');
      fsm['sm'].transition('active');

      fsm['sm'].transition('canceling');
      expect(fsm.phase).toBe('canceling');
    });

    it('should allow transition from canceling to canceled', () => {
      fsm['sm'].transition('connecting');
      fsm['sm'].transition('connected');
      fsm['sm'].transition('active');
      fsm['sm'].transition('canceling');

      fsm['sm'].transition('canceled');
      expect(fsm.phase).toBe('canceled');
    });

    it('should allow transition from error to canceled', () => {
      fsm['sm'].transition('connecting');
      fsm['sm'].transition('error');

      fsm['sm'].transition('canceled');
      expect(fsm.phase).toBe('canceled');
    });
  });

  describe('createMessageFSM', () => {
    beforeEach(() => {
      fsm['sm'].transition('connecting');
      fsm['sm'].transition('connected');
    });

    it('should create and store a MessageFSM', () => {
      const message = createMessage('msg-1');
      const msgFsm = fsm.createMessageFSM('msg-1', message);

      expect(msgFsm).toBeDefined();
      expect(msgFsm.msg.id).toBe('msg-1');
      expect(fsm.getMessageFSM('msg-1')).toBe(msgFsm);
    });

    it('should reuse existing MessageFSM with setMessage', () => {
      const message1 = createMessage('msg-1');
      const message2 = createMessage('msg-1');

      const msgFsm1 = fsm.createMessageFSM('msg-1', message1);
      const msgFsm2 = fsm.createMessageFSM('msg-1', message2);

      expect(msgFsm2).toBe(msgFsm1);
    });
  });

  describe('removeMessageFSM', () => {
    beforeEach(() => {
      fsm['sm'].transition('connecting');
      fsm['sm'].transition('connected');
    });

    it('should remove MessageFSM from map', () => {
      const message = createMessage('msg-1');
      fsm.createMessageFSM('msg-1', message);

      fsm.removeMessageFSM('msg-1');

      expect(fsm.getMessageFSM('msg-1')).toBeUndefined();
    });
  });

  describe('deactivate', () => {
    it('should close transport when idle', () => {
      const closeSpy = vi.spyOn(fsm as any, 'closeTransport');

      fsm.deactivate();

      expect(closeSpy).toHaveBeenCalled();
    });

    it('should transition to canceled when in connecting phase', () => {
      fsm['sm'].transition('connecting');

      fsm.deactivate();

      expect(fsm.phase).toBe('canceled');
    });

    it('should transition to canceled when in active phase', () => {
      fsm['sm'].transition('connecting');
      fsm['sm'].transition('connected');
      fsm['sm'].transition('active');

      fsm.deactivate();

      expect(fsm.phase).toBe('canceled');
    });

    it('should close all MessageFSMs when deactivating from active', () => {
      fsm['sm'].transition('connecting');
      fsm['sm'].transition('connected');

      const message = createMessage('msg-1');
      const msgFsm = fsm.createMessageFSM('msg-1', message);
      const closeSpy = vi.spyOn(msgFsm, 'close');

      fsm['sm'].transition('active');

      fsm.deactivate();

      expect(closeSpy).toHaveBeenCalled();
    });
  });

  describe('cancelConversation', () => {
    beforeEach(() => {
      fsm['sm'].transition('connecting');
      fsm['sm'].transition('connected');
    });

    it('should do nothing if not active', async () => {
      const sendCancelApi = vi.fn();

      await fsm.cancelConversation(sendCancelApi);

      expect(sendCancelApi).not.toHaveBeenCalled();
      expect(fsm.phase).toBe('connected');
    });

    it('should call cancel on all cancelable MessageFSMs when active', async () => {
      const message = createMessage('msg-1');
      const msgFsm = fsm.createMessageFSM('msg-1', message);
      msgFsm.handleEvent({
        type: 'start',
        messageId: 'msg-1',
        seq: 1,
        at: Date.now(),
      });

      const sendCancelApi = vi.fn().mockResolvedValue(undefined);
      await fsm.cancelConversation(sendCancelApi);

      expect(fsm.phase).toBe('canceled');
      expect(sendCancelApi).toHaveBeenCalled();
    });

    it('should transition to canceled on 404 error', async () => {
      const message = createMessage('msg-1');
      const msgFsm = fsm.createMessageFSM('msg-1', message);
      msgFsm.handleEvent({
        type: 'start',
        messageId: 'msg-1',
        seq: 1,
        at: Date.now(),
      });

      const sendCancelApi = vi
        .fn()
        .mockRejectedValue(new Error('404 Not Found'));
      await fsm.cancelConversation(sendCancelApi);

      expect(fsm.phase).toBe('canceled');
    });

    it('should transition to error on non-404 error', async () => {
      const message = createMessage('msg-1');
      const msgFsm = fsm.createMessageFSM('msg-1', message);
      msgFsm.handleEvent({
        type: 'start',
        messageId: 'msg-1',
        seq: 1,
        at: Date.now(),
      });

      const sendCancelApi = vi
        .fn()
        .mockRejectedValue(new Error('500 Server Error'));

      await expect(fsm.cancelConversation(sendCancelApi)).rejects.toThrow();

      expect(fsm.phase).toBe('error');
    });
  });

  describe('connected↔active driving', () => {
    beforeEach(() => {
      fsm['sm'].transition('connecting');
      fsm['sm'].transition('connected');
    });

    it('should transition to active when MessageFSM enters non-terminal state', () => {
      const message = createMessage('msg-1');
      fsm.createMessageFSM('msg-1', message);

      const msgFsm = fsm.getMessageFSM('msg-1')!;
      msgFsm.handleEvent({
        type: 'start',
        messageId: 'msg-1',
        seq: 1,
        at: Date.now(),
      });

      expect(fsm.phase).toBe('active');
    });

    it('should transition back to connected when all MessageFSMs reach terminal', () => {
      const message = createMessage('msg-1');
      fsm.createMessageFSM('msg-1', message);

      const msgFsm = fsm.getMessageFSM('msg-1')!;
      msgFsm.handleEvent({
        type: 'start',
        messageId: 'msg-1',
        seq: 1,
        at: Date.now(),
      });
      expect(fsm.phase).toBe('active');

      msgFsm.handleEvent({
        type: 'final',
        messageId: 'msg-1',
        seq: 2,
        at: Date.now(),
      });
      expect(fsm.phase).toBe('connected');
    });
  });

  describe('reconnect with active MessageFSM', () => {
    it('should transition to active when connect() succeeds with awaiting_input MessageFSM', async () => {
      const awaitingInputEvents: AgentEvent[] = [
        { type: 'start', messageId: 'msg-1', seq: 1, at: Date.now() },
        {
          type: 'tool_call',
          messageId: 'msg-1',
          callId: 'call-1',
          toolName: 'human_input',
          toolArgs: {},
          seq: 2,
          at: Date.now(),
        },
        {
          type: 'tool_progress',
          messageId: 'msg-1',
          callId: 'call-1',
          toolName: 'human_input',
          data: { status: 'awaiting_input', schema: { type: 'string' } },
          seq: 3,
          at: Date.now(),
        },
      ];

      const message: Message = {
        id: 'msg-1',
        role: Role.ASSIST,
        content: '',
        meta: { events: awaitingInputEvents },
        createdAt: new Date(),
        conversationId: 'conv-1',
      };

      fsm.restoreMessageFSM(message);

      const msgFsm = fsm.getMessageFSM('msg-1');
      expect(msgFsm?.phase).toBe('awaiting_input');

      const connectPromise = fsm.connect();

      await new Promise(r => setTimeout(r, 0));

      const transport = (fsm as any).transport;
      const es = (transport as any).eventSource as MockEventSource;
      es.emit('message', { type: 'connected' });

      await connectPromise;

      expect(fsm.phase).toBe('active');
    });

    it('should stay connected when all MessageFSMs are terminated', async () => {
      const finalEvents: AgentEvent[] = [
        { type: 'start', messageId: 'msg-1', seq: 1, at: Date.now() },
        { type: 'final', messageId: 'msg-1', seq: 2, at: Date.now() },
      ];

      const message: Message = {
        id: 'msg-1',
        role: Role.ASSIST,
        content: 'done',
        meta: { events: finalEvents },
        createdAt: new Date(),
        conversationId: 'conv-1',
      };

      fsm.restoreMessageFSM(message);

      const msgFsm = fsm.getMessageFSM('msg-1');
      expect(msgFsm?.phase).toBe('final');

      const connectPromise = fsm.connect();
      await new Promise(r => setTimeout(r, 0));
      const transport = (fsm as any).transport;
      const es = (transport as any).eventSource as MockEventSource;
      es.emit('message', { type: 'connected' });

      await connectPromise;

      expect(fsm.phase).toBe('connected');
    });
  });

  describe('computed properties', () => {
    it('hasActiveMessage should be true only in active phase', () => {
      expect(fsm.hasActiveMessage).toBe(false);

      fsm['sm'].transition('connecting');
      expect(fsm.hasActiveMessage).toBe(false);

      fsm['sm'].transition('connected');
      expect(fsm.hasActiveMessage).toBe(false);

      fsm['sm'].transition('active');
      expect(fsm.hasActiveMessage).toBe(true);
    });

    it('canStartChat should be true for idle and connected phases', () => {
      expect(fsm.canStartChat).toBe(true);

      fsm['sm'].transition('connecting');
      expect(fsm.canStartChat).toBe(false);

      fsm['sm'].transition('connected');
      expect(fsm.canStartChat).toBe(true);

      fsm['sm'].transition('active');
      expect(fsm.canStartChat).toBe(false);
    });

    it('isConnecting should be true only in connecting phase', () => {
      expect(fsm.isConnecting).toBe(false);

      fsm['sm'].transition('connecting');
      expect(fsm.isConnecting).toBe(true);

      fsm['sm'].transition('connected');
      expect(fsm.isConnecting).toBe(false);
    });
  });

  describe('SSE error handling', () => {
    it('should transition to error state via direct transition', () => {
      fsm['sm'].transition('connecting');
      expect(fsm.phase).toBe('connecting');

      fsm['sm'].transition('error');

      expect(fsm.phase).toBe('error');
    });

    it('should allow transition from error to canceled', () => {
      fsm['sm'].transition('connecting');
      fsm['sm'].transition('error');

      fsm['sm'].transition('canceled');

      expect(fsm.phase).toBe('canceled');
    });
  });

  describe('connection timeout (state machine)', () => {
    it('should allow transition from connecting to error', () => {
      fsm['sm'].transition('connecting');

      expect(fsm['sm'].canTransitionTo('error')).toBe(true);

      fsm['sm'].transition('error');

      expect(fsm.phase).toBe('error');
    });
  });

  describe('event routing', () => {
    beforeEach(() => {
      fsm['sm'].transition('connecting');
      fsm['sm'].transition('connected');
    });

    it('should route event to correct MessageFSM by messageId', () => {
      const message1 = createMessage('msg-1');
      const message2 = createMessage('msg-2');
      fsm.createMessageFSM('msg-1', message1);
      fsm.createMessageFSM('msg-2', message2);

      const msgFsm1 = fsm.getMessageFSM('msg-1')!;
      const msgFsm2 = fsm.getMessageFSM('msg-2')!;

      msgFsm1['sm'].transition('initialized');
      msgFsm2['sm'].transition('initialized');

      const handleEventSpy1 = vi.spyOn(msgFsm1, 'handleEvent');
      const handleEventSpy2 = vi.spyOn(msgFsm2, 'handleEvent');

      const event: AgentEvent = {
        type: 'stream',
        messageId: 'msg-1',
        content: 'Hello',
        seq: 1,
        at: Date.now(),
      };

      msgFsm1.handleEvent(event);

      expect(handleEventSpy1).toHaveBeenCalledWith(event);
      expect(handleEventSpy2).not.toHaveBeenCalled();
    });

    it('should route to first active FSM when no messageId in event', () => {
      const message1 = createMessage('msg-1');
      fsm.createMessageFSM('msg-1', message1);

      const msgFsm1 = fsm.getMessageFSM('msg-1')!;
      msgFsm1['sm'].transition('initialized');

      const event: AgentEvent = {
        type: 'stream',
        messageId: '',
        content: 'Hello',
        seq: 1,
        at: Date.now(),
      };
      void event;

      const activeFsm = (fsm as any).getFirstActiveFSM();
      expect(activeFsm).toBeDefined();
    });

    it('should warn when MessageFSM not found for messageId', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const event: AgentEvent = {
        type: 'stream',
        messageId: 'non-existent',
        content: 'Hello',
        seq: 1,
        at: Date.now(),
      };
      void event;

      const msgFsm = fsm.getMessageFSM('non-existent');
      expect(msgFsm).toBeUndefined();

      warnSpy.mockRestore();
    });
  });

  describe('session_ended and session_replaced events', () => {
    it('should allow transition from connected to idle', () => {
      fsm['sm'].transition('connecting');
      fsm['sm'].transition('connected');

      expect(fsm['sm'].canTransitionTo('idle')).toBe(true);

      fsm['sm'].transition('idle');

      expect(fsm.phase).toBe('idle');
    });

    it('should be able to reconnect from idle state', () => {
      fsm['sm'].transition('connecting');
      fsm['sm'].transition('connected');
      fsm['sm'].transition('idle');

      expect(fsm['sm'].canTransitionTo('connecting')).toBe(true);
    });
  });

  describe('deactivate from different phases', () => {
    it('should transition to canceled from connected phase', () => {
      fsm['sm'].transition('connecting');
      fsm['sm'].transition('connected');

      fsm.deactivate();

      expect(fsm.phase).toBe('canceled');
    });

    it('should transition to canceled from waiting phase', () => {
      fsm['sm'].transition('connecting');
      fsm['sm'].transition('connected');

      fsm.deactivate();

      expect(fsm.phase).toBe('canceled');
    });
  });
});
