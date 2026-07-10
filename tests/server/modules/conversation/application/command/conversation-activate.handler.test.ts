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
  activateContext: vi.fn(),
  getCtx: vi.fn(() => ({
    conversationId: 'conv_1',
    messages: { toArray: () => [] },
    config: { contextSize: 8000, runtimeConfig: {} },
    transforms: { forPhase: () => [] },
  })),
  sendFrame: vi.fn(),
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

  it('requireConversation 通过后:activate + 激活会话上下文 + 跑 activated transform', async () => {
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
    expect(stubSessionManager.activateContext).toHaveBeenCalledWith(
      'conv_1',
      [],
      { contextSize: 8000, runtimeConfig: {} },
    );
    expect(stubSessionManager.getCtx).toHaveBeenCalledWith('conv_1');
  });

  it('config 为 null 时不激活上下文', async () => {
    stubChatService.requireConversation.mockResolvedValueOnce(undefined);
    stubChatService.resolveConversationConfig.mockResolvedValueOnce(null);
    (stubSessionManager.activateContext as any).mockClear();
    const handler = makeHandler();

    await handler.execute(new ConversationActivateCommand('conv_1', 'user_1'));

    expect(stubSessionManager.activateContext).not.toHaveBeenCalled();
  });
});
