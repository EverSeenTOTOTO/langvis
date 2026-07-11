import { describe, it, expect, vi } from 'vitest';
import { CompleteTurnHandler } from '@/server/modules/conversation/application/event/complete-turn.handler';
import type { SessionManager } from '@/server/modules/conversation/application/service/session-manager';
import type { ChatService } from '@/server/modules/conversation/application/service/chat.service';
import type { DomainEvent } from '@/server/libs/ddd';
import type { EnrichedEvent } from '@/shared/types/events';
import type { RunCompletedPayload } from '@/server/modules/agent/contracts';
import type { Message } from '@/shared/types/entities';
import { ListMonad } from '@/server/libs/list';
import { ConvTransformPlan } from '@/server/modules/conversation/domain/model/conv-transform';

function ev(p: { type: string } & Record<string, unknown>): EnrichedEvent {
  return { runId: 'run_1', seq: 0, at: 0, ...p } as EnrichedEvent;
}

const assistantMsg = {
  id: 'msg_1',
  role: 'assistant',
  content: 'answer',
} as Message;

function makeCtx() {
  return {
    conversationId: 'conv_1',
    messages: ListMonad.of([]),
    config: { contextSize: 4096, runtimeConfig: {} },
    transforms: new ConvTransformPlan(),
  };
}

function setup(
  eventStream: EnrichedEvent[] | undefined,
  persistResult: Message | null = assistantMsg,
) {
  const ctx = makeCtx();
  const sessionManager = {
    awaitMaintenance: vi.fn().mockResolvedValue(undefined),
    getRunEvents: vi.fn().mockReturnValue(eventStream),
    getCtx: vi.fn(() => ctx),
    flushRunView: vi.fn(),
    sendFrame: vi.fn().mockReturnValue(true),
    beginMaintenance: vi.fn(),
    endMaintenance: vi.fn(),
    finalizeRun: vi.fn(),
  } as unknown as SessionManager;
  const chatService = {
    persistAssistantTurn: vi.fn().mockResolvedValue(persistResult),
  } as unknown as ChatService;
  const handler = new CompleteTurnHandler(sessionManager, chatService);
  return { handler, sessionManager, chatService, ctx };
}

describe('CompleteTurnHandler — turn-end 触发适配器（线性屏障）', () => {
  const conversationId = 'conv_1';
  const messageId = 'msg_1';
  const event = {
    payload: { conversationId, messageId, agentRunId: 'run_1' },
  } as DomainEvent<string, RunCompletedPayload>;

  it('有事件流：persist + append + flushRunView + usage 帧 + begin/end 维护 + finalize', async () => {
    const { handler, sessionManager, chatService, ctx } = setup([
      ev({ type: 'start' }),
      ev({ type: 'final' }),
    ]);

    await handler.handle(event);

    expect(chatService.persistAssistantTurn).toHaveBeenCalledWith(
      messageId,
      expect.any(Array),
    );
    expect(ctx.messages.length).toBe(1); // assistant appended
    expect(sessionManager.flushRunView).toHaveBeenCalledWith(
      conversationId,
      messageId,
    );
    expect(sessionManager.sendFrame).toHaveBeenCalledWith(
      conversationId,
      expect.objectContaining({ type: 'conversation_usage', total: 4096 }),
    );
    expect(sessionManager.beginMaintenance).toHaveBeenCalledWith(
      conversationId,
    );
    expect(sessionManager.endMaintenance).toHaveBeenCalledWith(conversationId);
    expect(sessionManager.finalizeRun).toHaveBeenCalledWith(
      conversationId,
      messageId,
    );
  });

  it('persist 返回 null：不 append，但仍 flush/usage/finalize', async () => {
    const { handler, sessionManager, ctx } = setup(
      [ev({ type: 'final' })],
      null,
    );

    await handler.handle(event);

    expect(ctx.messages.length).toBe(0);
    expect(sessionManager.flushRunView).toHaveBeenCalled();
    expect(sessionManager.finalizeRun).toHaveBeenCalledWith(
      conversationId,
      messageId,
    );
  });

  it('无事件流：只 finalize，不 persist/flush/发帧', async () => {
    const { handler, sessionManager, chatService } = setup(undefined);

    await handler.handle(event);

    expect(chatService.persistAssistantTurn).not.toHaveBeenCalled();
    expect(sessionManager.flushRunView).not.toHaveBeenCalled();
    expect(sessionManager.sendFrame).not.toHaveBeenCalled();
    expect(sessionManager.finalizeRun).toHaveBeenCalledWith(
      conversationId,
      messageId,
    );
  });

  it('persist 抛错时仍 end 维护 + finalize（catch 兜底，不漏 run，不 reject）', async () => {
    const sessionManager = {
      awaitMaintenance: vi.fn().mockResolvedValue(undefined),
      getRunEvents: vi.fn().mockReturnValue([ev({ type: 'final' })]),
      getCtx: vi.fn(() => makeCtx()),
      flushRunView: vi.fn(),
      sendFrame: vi.fn(),
      beginMaintenance: vi.fn(),
      endMaintenance: vi.fn(),
      finalizeRun: vi.fn(),
    } as unknown as SessionManager;
    const chatService = {
      persistAssistantTurn: vi.fn().mockRejectedValue(new Error('boom')),
    } as unknown as ChatService;
    const handler = new CompleteTurnHandler(sessionManager, chatService);

    await expect(handler.handle(event)).resolves.toBeUndefined();
    expect(sessionManager.endMaintenance).toHaveBeenCalledWith(conversationId);
    expect(sessionManager.finalizeRun).toHaveBeenCalledWith(
      conversationId,
      messageId,
    );
  });
});
