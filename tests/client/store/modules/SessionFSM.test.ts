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
    events: [],
    status: 'initialized',
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
    it('should start with null phase (no session yet)', () => {
      expect(fsm.phase).toBeNull();
    });

    it('should have correct conversationId', () => {
      expect(fsm.conversationId).toBe('conv-1');
    });

    it('should not be loading initially', () => {
      expect(fsm.isLoading).toBe(false);
    });

    it('should not be connected initially', () => {
      expect(fsm.isConnected).toBe(false);
    });

    it('should not be able to start chat initially', () => {
      expect(fsm.canStartChat).toBe(false);
    });
  });

  describe('connect', () => {
    it('should transition to connecting on connect', () => {
      fsm.connect();
      expect(fsm.phase).toBe('connecting');
    });

    it('should transition to connected after connection succeeds', async () => {
      const connectPromise = fsm.connect();
      await new Promise(r => setTimeout(r, 0));
      const transport = (fsm as any).transport;
      const es = (transport as any).eventSource as MockEventSource;
      es.emit('message', { type: 'connected' });

      await connectPromise;

      expect(fsm.phase).toBe('connected');
      expect(fsm.isConnecting).toBe(false);
      expect(fsm.isConnected).toBe(true);
    });

    it('should be idempotent when already connected', async () => {
      const connectPromise = fsm.connect();
      await new Promise(r => setTimeout(r, 0));
      const transport = (fsm as any).transport;
      const es = (transport as any).eventSource as MockEventSource;
      es.emit('message', { type: 'connected' });
      await connectPromise;

      // Second connect should resolve immediately
      await fsm.connect();
      expect(fsm.phase).toBe('connected');
    });

    it('should be able to start chat when connected', async () => {
      const connectPromise = fsm.connect();
      await new Promise(r => setTimeout(r, 0));
      const transport = (fsm as any).transport;
      const es = (transport as any).eventSource as MockEventSource;
      es.emit('message', { type: 'connected' });
      await connectPromise;

      expect(fsm.canStartChat).toBe(true);
    });

    it('should transition to error on connection failure', async () => {
      fsm.connect();
      await new Promise(r => setTimeout(r, 0));
      const transport = (fsm as any).transport;

      // Simulate disconnect during connecting
      transport.emit('disconnect');

      expect(fsm.phase).toBe('error');
    });

    it('should allow reconnect from error', async () => {
      fsm.connect();
      await new Promise(r => setTimeout(r, 0));
      const transport = (fsm as any).transport;
      transport.emit('disconnect');
      expect(fsm.phase).toBe('error');

      // Reconnect
      const reconnectPromise = fsm.connect();
      await new Promise(r => setTimeout(r, 0));
      const newTransport = (fsm as any).transport;
      (newTransport.eventSource as MockEventSource).emit('message', {
        type: 'connected',
      });
      await reconnectPromise;
      expect(fsm.phase).toBe('connected');
    });
  });

  describe('connected↔active driving', () => {
    async function connectSession() {
      const connectPromise = fsm.connect();
      await new Promise(r => setTimeout(r, 0));
      const transport = (fsm as any).transport;
      transport.eventSource.emit('message', { type: 'connected' });
      await connectPromise;
    }

    it('should transition to active when MessageFSM becomes active', async () => {
      await connectSession();

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

    it('should transition back to connected when all MessageFSMs terminate', async () => {
      await connectSession();

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

  describe('computed properties', () => {
    it('isLoading should be true when connecting or active', async () => {
      expect(fsm.isLoading).toBe(false);

      fsm.connect();
      expect(fsm.isLoading).toBe(true);

      // Complete connection
      const transport = (fsm as any).transport;
      transport.eventSource.emit('message', { type: 'connected' });
      await new Promise(r => setTimeout(r, 0));
      expect(fsm.isLoading).toBe(false);

      // Drive to active
      const message = createMessage('msg-1');
      fsm.createMessageFSM('msg-1', message);
      fsm.getMessageFSM('msg-1')!.handleEvent({
        type: 'start',
        messageId: 'msg-1',
        seq: 1,
        at: Date.now(),
      });
      expect(fsm.isLoading).toBe(true);
    });

    it('canStartChat should be true only in connected phase', async () => {
      expect(fsm.canStartChat).toBe(false);

      fsm.connect();
      expect(fsm.canStartChat).toBe(false);

      const transport = (fsm as any).transport;
      transport.eventSource.emit('message', { type: 'connected' });
      await new Promise(r => setTimeout(r, 0));
      expect(fsm.canStartChat).toBe(true);

      // Drive to active
      const message = createMessage('msg-1');
      fsm.createMessageFSM('msg-1', message);
      fsm.getMessageFSM('msg-1')!.handleEvent({
        type: 'start',
        messageId: 'msg-1',
        seq: 1,
        at: Date.now(),
      });
      expect(fsm.canStartChat).toBe(false);
    });
  });

  describe('deactivate', () => {
    it('should transition to done and null phase', () => {
      fsm.deactivate();
      expect(fsm.phase).toBeNull();
    });

    it('should close all MessageFSMs when deactivating', () => {
      const message = createMessage('msg-1');
      const msgFsm = fsm.createMessageFSM('msg-1', message);
      const closeSpy = vi.spyOn(msgFsm, 'close');

      fsm.deactivate();

      expect(closeSpy).toHaveBeenCalled();
    });
  });

  describe('cancelConversation', () => {
    it('should do nothing if not active', async () => {
      const sendCancelApi = vi.fn();
      await fsm.cancelConversation(sendCancelApi);

      expect(sendCancelApi).not.toHaveBeenCalled();
    });

    it('should transition to canceling when active', async () => {
      // Connect
      const connectPromise = fsm.connect();
      await new Promise(r => setTimeout(r, 0));
      (fsm as any).transport.eventSource.emit('message', { type: 'connected' });
      await connectPromise;

      // Drive to active
      const message = createMessage('msg-1');
      fsm.createMessageFSM('msg-1', message);
      fsm.getMessageFSM('msg-1')!.handleEvent({
        type: 'start',
        messageId: 'msg-1',
        seq: 1,
        at: Date.now(),
      });
      expect(fsm.phase).toBe('active');

      const sendCancelApi = vi.fn().mockResolvedValue(undefined);
      await fsm.cancelConversation(sendCancelApi);

      expect(fsm.phase).toBe('canceling');
      expect(sendCancelApi).toHaveBeenCalled();
    });

    it('should transition to error on non-404 error', async () => {
      // Connect
      const connectPromise = fsm.connect();
      await new Promise(r => setTimeout(r, 0));
      (fsm as any).transport.eventSource.emit('message', { type: 'connected' });
      await connectPromise;

      // Drive to active
      const message = createMessage('msg-1');
      fsm.createMessageFSM('msg-1', message);
      fsm.getMessageFSM('msg-1')!.handleEvent({
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

  describe('event routing', () => {
    it('should route event to correct MessageFSM by messageId', () => {
      const message1 = createMessage('msg-1');
      const message2 = createMessage('msg-2');
      fsm.createMessageFSM('msg-1', message1);
      fsm.createMessageFSM('msg-2', message2);

      const msgFsm1 = fsm.getMessageFSM('msg-1')!;
      const msgFsm2 = fsm.getMessageFSM('msg-2')!;

      const handleEventSpy1 = vi.spyOn(msgFsm1, 'handleEvent');
      const handleEventSpy2 = vi.spyOn(msgFsm2, 'handleEvent');

      const event: AgentEvent = {
        type: 'stream',
        messageId: 'msg-1',
        content: 'Hello',
        seq: 1,
        at: Date.now(),
      };

      fsm['handleEvent'](event);

      expect(handleEventSpy1).toHaveBeenCalledWith(event);
      expect(handleEventSpy2).not.toHaveBeenCalled();
    });

    it('should intercept context_usage at session level, not route to MessageFSM', () => {
      const message1 = createMessage('msg-1');
      fsm.createMessageFSM('msg-1', message1);

      const msgFsm1 = fsm.getMessageFSM('msg-1')!;
      const handleEventSpy = vi.spyOn(msgFsm1, 'handleEvent');

      const event: AgentEvent = {
        type: 'context_usage',
        messageId: 'msg-1',
        used: 100,
        total: 200,
        seq: 1,
        at: Date.now(),
      };

      fsm['handleEvent'](event);

      expect(handleEventSpy).not.toHaveBeenCalled();
      expect(onEvent).toHaveBeenCalledWith(event);
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

      fsm['handleEvent'](event);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('non-existent'),
      );

      warnSpy.mockRestore();
    });
  });
});
