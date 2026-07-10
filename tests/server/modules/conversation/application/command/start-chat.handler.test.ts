import { describe, it, expect, vi } from 'vitest';

import { StartChatHandler } from '@/server/modules/conversation/application/command/start-chat.handler';
import type { ChatService } from '@/server/modules/conversation/application/service/chat.service';
import type { SessionManager } from '@/server/modules/conversation/application/service/session-manager';
import type { EventBus } from '@/server/libs/ddd';
import type { AgentRunRepositoryPort } from '@/server/modules/agent/domain/port/agent-run.repository.port';
import {
  StartChatCommand,
  TurnInitiated,
} from '@/server/modules/conversation/contracts';
import { ConversationNotFoundError } from '@/server/modules/conversation/domain/errors';
import { Role } from '@/shared/entities/Message';

const stubEventBus = { dispatch: vi.fn() };
const stubAgentRunRepo = {
  findByIds: vi.fn().mockResolvedValue([]),
} as unknown as AgentRunRepositoryPort;

function makeSessionManager(memory: any) {
  return {
    getMemory: vi.fn(() => memory),
  } as unknown as SessionManager;
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
      makeSessionManager({}),
      stubEventBus as unknown as EventBus,
      stubAgentRunRepo,
    );

    await expect(
      handler.execute(
        new StartChatCommand(
          'conv_1',
          { role: Role.USER, content: 'hi' },
          'user_1',
        ),
      ),
    ).rejects.toBeInstanceOf(ConversationNotFoundError);

    expect(stubEventBus.dispatch).not.toHaveBeenCalled();
  });

  it('appends user message, builds context, dispatches TurnInitiated, returns assistantId', async () => {
    const memory = {
      append: vi.fn(),
      getMessages: vi.fn(() => []),
      buildContext: vi
        .fn()
        .mockResolvedValue([{ role: 'system', content: 'sys' }]),
    };
    const chatService = {
      startTurn: vi.fn().mockResolvedValue({
        userMessage: { id: 'msg_u', role: 'user', content: 'hi' },
        assistantMessage: { id: 'msg_a', role: 'assistant', content: '' },
        userConfig: { model: { modelId: 'm1' } },
        systemPrompt: 'sys',
      }),
    } as unknown as ChatService;
    const handler = new StartChatHandler(
      chatService,
      makeSessionManager(memory),
      stubEventBus as unknown as EventBus,
      stubAgentRunRepo,
    );

    const result = await handler.execute(
      new StartChatCommand(
        'conv_1',
        { role: Role.USER, content: 'hi' },
        'user_1',
      ),
    );

    expect(chatService.startTurn).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv_1', userId: 'user_1' }),
    );
    expect(memory.append).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'msg_u' }),
    );
    expect(stubEventBus.dispatch).toHaveBeenCalledWith(
      TurnInitiated,
      expect.objectContaining({
        payload: expect.objectContaining({
          assistantMessage: expect.objectContaining({ id: 'msg_a' }),
          systemPrompt: 'sys',
          effectiveHistory: [{ role: 'system', content: 'sys' }],
        }),
      }),
    );
    expect(result).toEqual({ assistantId: 'msg_a' });
  });
});
