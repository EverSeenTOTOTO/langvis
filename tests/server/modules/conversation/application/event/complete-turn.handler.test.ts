import { describe, it, expect, vi } from 'vitest';
import { CompleteTurnHandler } from '@/server/modules/conversation/application/event/complete-turn.handler';
import type { SessionManager } from '@/server/modules/conversation/application/service/session-manager';
import type { ChatService } from '@/server/modules/conversation/application/service/chat.service';
import type { DomainEvent } from '@/server/libs/ddd';
import type { EnrichedEvent } from '@/shared/types/events';
import type { RunCompletedPayload } from '@/server/modules/conversation/contracts';

function ev(p: { type: string } & Record<string, unknown>): EnrichedEvent {
  return { runId: 'run_1', seq: 0, at: 0, ...p } as EnrichedEvent;
}

describe('CompleteTurnHandler — 读 session 缓冲 + 发帧(投影/压缩在 ChatService)', () => {
  const conversationId = 'conv_1';
  const messageId = 'msg_1';

  const event = {
    payload: { conversationId, messageId, agentRunId: 'run_1' },
  } as DomainEvent<string, RunCompletedPayload>;

  function setup(
    eventStream: EnrichedEvent[] | undefined,
    completeTurnResult: { used: number; total: number } | null = null,
    memory: Record<string, unknown> = {},
  ) {
    const sessionManager = {
      getRunEvents: vi.fn().mockReturnValue(eventStream),
      getMemory: vi.fn().mockReturnValue(memory),
      sendFrame: vi.fn().mockReturnValue(true),
      finalizeRun: vi.fn(),
    } as unknown as SessionManager;
    const chatService = {
      completeTurn: vi.fn().mockResolvedValue(completeTurnResult),
    } as unknown as ChatService;
    const handler = new CompleteTurnHandler(sessionManager, chatService);
    return { handler, sessionManager, chatService };
  }

  it('有事件流时:调 completeTurn + 发 usage 帧 + finalize', async () => {
    const { handler, sessionManager, chatService } = setup(
      [ev({ type: 'start' }), ev({ type: 'final' })],
      { used: 5, total: 4096 },
    );

    await handler.handle(event);

    expect(chatService.completeTurn).toHaveBeenCalledWith({
      conversationId,
      messageId,
      events: expect.any(Array),
      memory: expect.any(Object),
    });
    expect(sessionManager.sendFrame).toHaveBeenCalledWith(conversationId, {
      type: 'conversation_usage',
      used: 5,
      total: 4096,
    });
    expect(sessionManager.finalizeRun).toHaveBeenCalledWith(
      conversationId,
      messageId,
    );
  });

  it('completeTurn 返回 null 时不发帧,但仍 finalize', async () => {
    const { handler, sessionManager, chatService } = setup(
      [ev({ type: 'final' })],
      null,
    );

    await handler.handle(event);

    expect(chatService.completeTurn).toHaveBeenCalled();
    expect(sessionManager.sendFrame).not.toHaveBeenCalled();
    expect(sessionManager.finalizeRun).toHaveBeenCalledWith(
      conversationId,
      messageId,
    );
  });

  it('无事件流时:只 finalize,不调 completeTurn、不发帧', async () => {
    const { handler, sessionManager, chatService } = setup(undefined);

    await handler.handle(event);

    expect(chatService.completeTurn).not.toHaveBeenCalled();
    expect(sessionManager.sendFrame).not.toHaveBeenCalled();
    expect(sessionManager.finalizeRun).toHaveBeenCalledWith(
      conversationId,
      messageId,
    );
  });

  it('completeTurn 抛错时仍 finalize(finally 兜底,不漏 run)', async () => {
    const sessionManager = {
      getRunEvents: vi.fn().mockReturnValue([ev({ type: 'final' })]),
      getMemory: vi.fn().mockReturnValue({}),
      sendFrame: vi.fn(),
      finalizeRun: vi.fn(),
    } as unknown as SessionManager;
    const chatService = {
      completeTurn: vi.fn().mockRejectedValue(new Error('boom')),
    } as unknown as ChatService;
    const handler = new CompleteTurnHandler(sessionManager, chatService);

    await expect(handler.handle(event)).rejects.toThrow('boom');
    expect(sessionManager.finalizeRun).toHaveBeenCalledWith(
      conversationId,
      messageId,
    );
  });
});
