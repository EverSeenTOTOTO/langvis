import 'reflect-metadata';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationStore } from '@/client/store/modules/conversation';
import { Role } from '@/shared/types/entities';
import type { Message } from '@/shared/types/entities';

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

describe('ConversationStore Typewriter', () => {
  let store: ConversationStore;
  const conversationId = 'test-conv-id';

  const createStreamingMessage = (content = ''): Message => ({
    id: 'msg-1',
    role: Role.ASSIST,
    content,
    conversationId,
    createdAt: new Date(),
    meta: { streaming: true },
  });

  beforeEach(() => {
    vi.useFakeTimers();
    store = new ConversationStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should buffer delta content and start typewriter', () => {
    store.messages[conversationId] = [createStreamingMessage()];

    store.updateStreamingMessage(conversationId, 'Hello');

    expect(store.messages[conversationId][0].content).toBe('');

    const state = (store as any).streamingStates.get(conversationId);
    expect(state).toBeDefined();
    expect(state.buffer).toBe('Hello');
    expect(state.timer).not.toBeNull();
  });

  it('should flush buffer in chunks over time', () => {
    store.messages[conversationId] = [createStreamingMessage()];

    store.updateStreamingMessage(conversationId, 'Hello World');

    vi.advanceTimersByTime(15);
    expect(store.messages[conversationId][0].content).toBe('Hel');

    vi.advanceTimersByTime(15);
    expect(store.messages[conversationId][0].content).toBe('Hello ');

    vi.advanceTimersByTime(15);
    expect(store.messages[conversationId][0].content).toBe('Hello Wor');

    vi.advanceTimersByTime(15);
    expect(store.messages[conversationId][0].content).toBe('Hello World');
  });

  it('should accumulate multiple delta updates in buffer', () => {
    store.messages[conversationId] = [createStreamingMessage()];

    store.updateStreamingMessage(conversationId, 'Hi');
    store.updateStreamingMessage(conversationId, ' there');

    const state = (store as any).streamingStates.get(conversationId);
    expect(state.buffer).toBe('Hi there');
  });

  it('should update meta without affecting buffer', () => {
    store.messages[conversationId] = [createStreamingMessage()];

    store.updateStreamingMessage(conversationId, undefined, { loading: false });

    expect(store.messages[conversationId][0].meta).toEqual({ loading: false });
    expect((store as any).streamingStates.has(conversationId)).toBe(false);
  });

  it('should clear streaming state and stop timer', () => {
    store.messages[conversationId] = [createStreamingMessage()];

    store.updateStreamingMessage(conversationId, 'Test');

    store.clearStreaming(conversationId);

    expect((store as any).streamingStates.has(conversationId)).toBe(false);
    vi.advanceTimersByTime(100);
    expect(store.messages[conversationId][0].content).toBe('');
  });

  it('should stop typewriter when buffer is empty', () => {
    store.messages[conversationId] = [createStreamingMessage()];

    store.updateStreamingMessage(conversationId, 'Hi');

    vi.advanceTimersByTime(15);
    expect(store.messages[conversationId][0].content).toBe('Hi');

    vi.advanceTimersByTime(15);
    expect((store as any).streamingStates.has(conversationId)).toBe(false);
  });

  it('should stop typewriter when message is no longer active', () => {
    store.messages[conversationId] = [createStreamingMessage()];

    store.updateStreamingMessage(conversationId, 'Hello');

    store.messages[conversationId][0] = {
      ...store.messages[conversationId][0],
      meta: {},
    };

    vi.advanceTimersByTime(15);

    expect((store as any).streamingStates.has(conversationId)).toBe(false);
  });

  it('should not start typewriter if no messages exist', () => {
    store.updateStreamingMessage(conversationId, 'Test');

    expect((store as any).streamingStates.has(conversationId)).toBe(false);
  });

  it('should not start typewriter if last message is not active assist', () => {
    store.messages[conversationId] = [
      {
        id: 'msg-1',
        role: Role.USER,
        content: 'User message',
        conversationId,
        createdAt: new Date(),
        meta: null,
      },
    ];

    store.updateStreamingMessage(conversationId, 'Test');

    expect((store as any).streamingStates.has(conversationId)).toBe(false);
  });
});
