import { describe, it, expect, vi } from 'vitest';

import { ConversationActivateHandler } from '@/server/modules/conversation/application/command/conversation-activate.handler';
import type { ChatService } from '@/server/modules/conversation/application/service/chat.service';
import type { SessionManager } from '@/server/modules/conversation/application/service/session-manager';
import { ConversationActivateCommand } from '@/server/modules/conversation/contracts';
import { ConversationNotFoundError } from '@/server/modules/conversation/domain/errors';

const stubChatService = {
  requireConversation: vi.fn(),
  activate: vi.fn().mockResolvedValue(undefined),
  getConversationMessages: vi.fn().mockResolvedValue([]),
  resolveConversationConfig: vi.fn().mockResolvedValue(null),
};
const stubAgentService = {
  getSystemPrompt: vi.fn(() => Promise.resolve('')),
};
const stubSessionManager = {
  activateMemory: vi.fn(),
} as unknown as SessionManager;

function makeHandler() {
  return new ConversationActivateHandler(
    stubChatService as unknown as ChatService,
    stubAgentService as any,
    stubSessionManager,
  );
}

describe('ConversationActivateHandler', () => {
  it('propagates requireConversation failure (归属不存在/非本人统一 NotFound)', async () => {
    stubChatService.requireConversation.mockRejectedValueOnce(
      new ConversationNotFoundError('conv_1'),
    );
    const handler = makeHandler();

    await expect(
      handler.execute(new ConversationActivateCommand('conv_1', 'user_1')),
    ).rejects.toBeInstanceOf(ConversationNotFoundError);

    expect(stubChatService.activate).not.toHaveBeenCalled();
  });

  it('requireConversation 通过后:activate + 预热会话记忆', async () => {
    stubChatService.requireConversation.mockResolvedValueOnce(undefined);
    stubChatService.resolveConversationConfig.mockResolvedValueOnce({
      contextSize: 8000,
      runtimeConfig: {},
    });
    const handler = makeHandler();

    await handler.execute(new ConversationActivateCommand('conv_1', 'user_1'));

    expect(stubChatService.requireConversation).toHaveBeenCalledWith(
      'conv_1',
      'user_1',
    );
    expect(stubChatService.activate).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv_1', userId: 'user_1' }),
    );
    expect(stubSessionManager.activateMemory).toHaveBeenCalled();
  });

  it('config 为 null 时不预热记忆', async () => {
    stubChatService.requireConversation.mockResolvedValueOnce(undefined);
    stubChatService.resolveConversationConfig.mockResolvedValueOnce(null);
    (stubSessionManager.activateMemory as any).mockClear();
    const handler = makeHandler();

    await handler.execute(new ConversationActivateCommand('conv_1', 'user_1'));

    expect(stubSessionManager.activateMemory).not.toHaveBeenCalled();
  });
});
