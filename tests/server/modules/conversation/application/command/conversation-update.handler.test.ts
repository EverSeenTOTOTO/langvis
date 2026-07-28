import { describe, it, expect, vi } from 'vitest';
import { ConversationUpdateHandler } from '@/server/modules/conversation/application/command/conversation-update.handler';
import type { ConversationRepositoryPort } from '@/server/modules/conversation/domain/port/conversation.repository.port';
import type { ChatService } from '@/server/modules/conversation/application/service/chat.service';
import type { SessionManager } from '@/server/modules/conversation/application/service/session-manager';
import { ConversationUpdateCommand } from '@/server/modules/conversation/contracts';
import { ConversationNotFoundError } from '@/server/modules/conversation/domain/errors';

function makeRepo(conv: any, updated: any = conv) {
  return {
    findById: vi.fn().mockResolvedValue(conv),
    update: vi.fn().mockResolvedValue(updated),
  } as unknown as ConversationRepositoryPort;
}

function makeChatService(resolved: any) {
  return {
    resolveConversationConfig: vi.fn().mockResolvedValue(resolved),
  } as unknown as ChatService;
}

function makeSessionManager() {
  return {
    refreshRuntimeConfig: vi.fn(),
  } as unknown as SessionManager;
}

const existing = {
  id: 'conv_1',
  userId: 'user_1',
  config: { model: { modelId: 'm1' } },
};

describe('ConversationUpdateHandler', () => {
  it('throws ConversationNotFoundError when conversation missing', async () => {
    const repo = makeRepo(null);
    const handler = new ConversationUpdateHandler(
      repo,
      makeChatService(null),
      makeSessionManager(),
    );

    await expect(
      handler.execute(
        new ConversationUpdateCommand('conv_1', 'user_1', 'new name', {
          model: { modelId: 'm1' },
        }),
      ),
    ).rejects.toBeInstanceOf(ConversationNotFoundError);

    expect(repo.update).not.toHaveBeenCalled();
  });

  it('allows update with new config', async () => {
    const repo = makeRepo(existing);
    const handler = new ConversationUpdateHandler(
      repo,
      makeChatService(null),
      makeSessionManager(),
    );

    const result = await handler.execute(
      new ConversationUpdateCommand(
        'conv_1',
        'user_1',
        'new name',
        { model: { modelId: 'm2' } },
        'grp_1',
      ),
    );

    expect(repo.update).toHaveBeenCalledWith(
      'conv_1',
      'new name',
      'user_1',
      { model: { modelId: 'm2' } },
      'grp_1',
      undefined,
    );
    expect(result).toBe(existing);
  });

  it('allows update when config is undefined (no change)', async () => {
    const repo = makeRepo(existing);
    const sessionManager = makeSessionManager();
    const handler = new ConversationUpdateHandler(
      repo,
      makeChatService(null),
      sessionManager,
    );

    await handler.execute(
      new ConversationUpdateCommand('conv_1', 'user_1', 'new name'),
    );

    expect(repo.update).toHaveBeenCalledWith(
      'conv_1',
      'new name',
      'user_1',
      undefined,
      undefined,
      undefined,
    );
    expect(sessionManager.refreshRuntimeConfig).not.toHaveBeenCalled();
  });

  // 回归：已激活会话改配置后须刷新 session 的 runtimeConfig 缓存，否则下一轮仍用旧模型
  // （contextSize/contextUsage 也跟着错）。
  it('refreshes the active session runtimeConfig when config changes', async () => {
    const updatedConv = { ...existing, config: { model: { modelId: 'm2' } } };
    const repo = makeRepo(existing, updatedConv);
    const chatService = makeChatService({ model: { modelId: 'm2' } });
    const sessionManager = makeSessionManager();
    const handler = new ConversationUpdateHandler(
      repo,
      chatService,
      sessionManager,
    );

    await handler.execute(
      new ConversationUpdateCommand('conv_1', 'user_1', 'n', {
        model: { modelId: 'm2' },
      }),
    );

    expect(chatService.resolveConversationConfig).toHaveBeenCalledWith(
      'conv_1',
    );
    expect(sessionManager.refreshRuntimeConfig).toHaveBeenCalledWith('conv_1', {
      model: { modelId: 'm2' },
    });
  });

  it('does not refresh runtimeConfig when config is not part of the update', async () => {
    const repo = makeRepo(existing);
    const chatService = makeChatService({ model: { modelId: 'm2' } });
    const sessionManager = makeSessionManager();
    const handler = new ConversationUpdateHandler(
      repo,
      chatService,
      sessionManager,
    );

    await handler.execute(
      new ConversationUpdateCommand('conv_1', 'user_1', 'renamed', undefined),
    );

    expect(chatService.resolveConversationConfig).not.toHaveBeenCalled();
    expect(sessionManager.refreshRuntimeConfig).not.toHaveBeenCalled();
  });
});
