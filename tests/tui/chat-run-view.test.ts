import { describe, it, expect, beforeEach } from 'vitest';
import type { ReActStep, AwaitingInputProjection } from '@/shared/types/render';
import type { StreamFrame } from '@/shared/types/events';
import { ChatStore } from '@/client/store/modules/chat';

const runView = (
  over: Partial<{
    content: string;
    status: 'running' | 'completed';
    steps: ReActStep[];
    awaitingInput: AwaitingInputProjection | null;
  }> = {},
): StreamFrame =>
  ({
    type: 'run_view',
    messageId: 'm1',
    runId: 'r1',
    content: '',
    status: 'running',
    steps: [],
    awaitingInput: null,
    audio: null,
    hooks: [],
    ...over,
  }) as StreamFrame;

// Drive the real SSE frame handler with a fake transport; node creation stubs the live POST path.
describe('run_view arriving before its MessageNode exists', () => {
  const awaitingInput = {
    runId: 'r1',
    callId: 'c1',
    message: 'Need input',
    schema: {},
  };

  let chat: ChatStore;
  let emit: (frame: StreamFrame) => void;

  beforeEach(() => {
    chat = new ChatStore(
      {
        messages: {},
        currentConversationId: 'cv',
        conversationUsage: null,
        loopUsage: new Map(),
        fetchMessages: async () => [],
      } as any,
      {} as any,
    );

    const listeners: Record<string, ((e: { detail: unknown }) => void)[]> = {};
    const fakeTransport = {
      addEventListener(type: string, cb: (e: { detail: unknown }) => void) {
        (listeners[type] ??= []).push(cb);
      },
      removeEventListener() {},
    };
    (chat as any).setupTransportListeners('cv', fakeTransport);
    emit = (frame: StreamFrame) => {
      for (const cb of listeners['message'] ?? []) cb({ detail: frame });
    };
  });

  it('buffers a blocking ask_user frame and backfills it after node creation', () => {
    // run_view 携带 awaitingInput 的最后帧早到——节点尚未创建（POST 未返回）→ 暂存而非丢弃。
    emit(
      runView({
        steps: [
          {
            thought: '',
            startedAt: 0,
            action: {
              callId: 'c1',
              toolName: 'AskUser',
              toolArgs: {},
              status: 'pending',
            },
          },
        ],
        awaitingInput,
      }),
    );

    // 节点建好（POST 返回）→ 补灌暂存帧 → 进入 ask 态而非卡 thinking。
    (chat as any).addAssistantMessage('cv', 'm1');
    const node = chat.getMessageNode('cv', 'm1')!;
    expect(node).toBeDefined();
    expect(node.isAwaitingInput).toBe(true);
    expect(node.awaitingInput).toMatchObject({ callId: 'c1' });
    expect(node.hasPendingTools).toBe(true);
    expect(node.isThinking).toBe(false);
  });

  it('keeps the latest buffered frame when several arrive before the node', () => {
    emit(runView({ content: 'earlier' }));
    emit(runView({ awaitingInput }));
    (chat as any).addAssistantMessage('cv', 'm1');
    const node = chat.getMessageNode('cv', 'm1')!;
    expect(node.content).toBe('');
    expect(node.isAwaitingInput).toBe(true);
  });

  it('applies a frame directly when the node already exists (control)', () => {
    (chat as any).addAssistantMessage('cv', 'm1');
    emit(runView({ status: 'completed' }));
    const node = chat.getMessageNode('cv', 'm1')!;
    expect(node.status).toBe('completed');
  });
});
