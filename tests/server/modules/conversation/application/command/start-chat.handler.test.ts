import { describe, it, expect, vi } from 'vitest';
import { StartChatHandler } from '@/server/modules/conversation/application/command/start-chat.handler';
import type { ChatService } from '@/server/modules/conversation/application/service/chat.service';
import type { ConversationRepositoryPort } from '@/server/modules/conversation/domain/port/conversation.repository.port';
import type { AgentService } from '@/server/modules/agent/application/service/agent.service';
import type { EventBus } from '@/server/libs/ddd';
import { StartChatCommand } from '@/server/modules/conversation/contracts';
import { ConversationNotFoundError } from '@/server/modules/conversation/domain/errors';

function makeConvRepo(conv: any) {
  return {
    findById: vi.fn().mockResolvedValue(conv),
  } as unknown as ConversationRepositoryPort;
}

const stubAgentService = { buildSystemPrompt: vi.fn().mockReturnValue('') };
const stubEventBus = { dispatch: vi.fn() };

function makeHandler(conv: any, chatService: Partial<ChatService>) {
  return new StartChatHandler(
    chatService as unknown as ChatService,
    makeConvRepo(conv),
    stubAgentService as unknown as AgentService,
    stubEventBus as unknown as EventBus,
  );
}

describe('StartChatHandler', () => {
  it('throws ConversationNotFoundError when conversation missing', async () => {
    const chatService = { assertActivated: vi.fn(), appendMessage: vi.fn() };
    const handler = makeHandler(null, chatService);

    await expect(
      handler.execute(
        new StartChatCommand('conv_1', {
          role: 'user' as any,
          content: 'hi',
        }),
      ),
    ).rejects.toBeInstanceOf(ConversationNotFoundError);

    expect(chatService.assertActivated).not.toHaveBeenCalled();
  });

  it('relies on assertActivated (no silent activate)', async () => {
    // assertActivated throws → proves start no longer silently activates.
    const chatService = {
      assertActivated: vi
        .fn()
        .mockRejectedValue(new Error('CONVERSATION_NOT_ACTIVATED')),
      appendMessage: vi.fn(),
    };
    const handler = makeHandler({ userId: 'user_1', config: {} }, chatService);

    await expect(
      handler.execute(
        new StartChatCommand('conv_1', {
          role: 'user' as any,
          content: 'hi',
        }),
      ),
    ).rejects.toThrow('CONVERSATION_NOT_ACTIVATED');

    expect(chatService.assertActivated).toHaveBeenCalledWith('conv_1');
    expect(chatService.appendMessage).not.toHaveBeenCalled();
  });
});
