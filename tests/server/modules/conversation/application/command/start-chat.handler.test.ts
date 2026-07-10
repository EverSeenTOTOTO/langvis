import { describe, it, expect, vi } from 'vitest';

import { StartChatHandler } from '@/server/modules/conversation/application/command/start-chat.handler';
import type { ChatService } from '@/server/modules/conversation/application/service/chat.service';
import type { SessionManager } from '@/server/modules/conversation/application/service/session-manager';
import type { EventBus } from '@/server/libs/ddd';
import {
  StartChatCommand,
  TurnInitiated,
} from '@/server/modules/conversation/contracts';
import { ConversationNotFoundError } from '@/server/modules/conversation/domain/errors';
import { Role } from '@/shared/entities/Message';
import type { Message } from '@/shared/types/entities';
import { ListMonad } from '@/server/libs/list';
import { ConvTransformPlan } from '@/server/modules/conversation/domain/model/conv-transform';

const stubEventBus = { dispatch: vi.fn() } as unknown as EventBus;

function makeSessionManager(seed: Message[] = []) {
  const ctx = {
    conversationId: 'conv_1',
    messages: ListMonad.of(seed),
    config: { contextSize: 8000, runtimeConfig: {} },
    transforms: new ConvTransformPlan(),
  };
  return {
    ctx,
    awaitMaintenance: vi.fn().mockResolvedValue(undefined),
    getCtx: vi.fn(() => ctx),
    sendFrame: vi.fn(),
  } as unknown as SessionManager & { ctx: typeof ctx };
}

describe('StartChatHandler', () => {
  it('propagates startTurn failure (e.g. NotFound) and does not dispatch', async () => {
    const chatService = {
      startTurn: vi
        .fn()
        .mockRejectedValue(new ConversationNotFoundError('conv_1')),
    } as unknown as ChatService;
    const handler = new StartChatHandler(
      chatService,
      makeSessionManager(),
      stubEventBus,
    );

    await expect(
      handler.execute(
        new StartChatCommand('conv_1', { role: Role.USER, content: 'hi' }, 'user_1'),
      ),
    ).rejects.toBeInstanceOf(ConversationNotFoundError);

    expect(stubEventBus.dispatch).not.toHaveBeenCalled();
  });

  it('awaits maintenance, appends user message, projects, dispatches TurnInitiated', async () => {
    const sm = makeSessionManager([
      { id: 'msg_s', role: Role.SYSTEM, content: 'sys' } as Message,
    ]);
    const chatService = {
      startTurn: vi.fn().mockResolvedValue({
        userMessage: { id: 'msg_u', role: 'user', content: 'hi' },
        assistantMessage: { id: 'msg_a', role: 'assistant', content: '' },
        userConfig: { model: { modelId: 'm1' } },
        systemPrompt: 'sys',
      }),
    } as unknown as ChatService;
    const handler = new StartChatHandler(chatService, sm, stubEventBus);

    const result = await handler.execute(
      new StartChatCommand('conv_1', { role: Role.USER, content: 'hi' }, 'user_1'),
    );

    expect(sm.awaitMaintenance).toHaveBeenCalledWith('conv_1');
    expect(sm.getCtx).toHaveBeenCalledWith('conv_1');
    // userMessage appended after the barrier
    expect(sm.ctx.messages.toArray().map(m => m.id)).toEqual([
      'msg_s',
      'msg_u',
    ]);
    expect(stubEventBus.dispatch).toHaveBeenCalledWith(
      TurnInitiated,
      expect.objectContaining({
        payload: expect.objectContaining({
          assistantMessage: expect.objectContaining({ id: 'msg_a' }),
          systemPrompt: 'sys',
          effectiveHistory: [
            { role: 'system', content: 'sys' },
            { role: 'user', content: 'hi' },
          ],
        }),
      }),
    );
    expect(result).toEqual({ assistantId: 'msg_a' });
  });
});
