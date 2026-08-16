import { describe, it, expect, vi } from 'vitest';
import { TruncateChatHandler } from '@/server/modules/conversation/application/command/truncate-chat.handler';
import type { ChatService } from '@/server/modules/conversation/application/service/chat.service';
import type { SessionManager } from '@/server/modules/conversation/application/service/session-manager';
import { TruncateConversationCommand } from '@/server/modules/conversation/contracts';
import { MessageNotFoundError } from '@/server/modules/conversation/domain/errors';
import { Role } from '@/shared/entities/Message';
import type { Message } from '@/shared/types/entities';

const msg = (
  id: string,
  role: Role,
  content: string,
  meta?: unknown,
): Message =>
  ({
    id,
    conversationId: 'conv_1',
    role,
    content,
    meta: meta ?? null,
    createdAt: new Date(0),
  }) as Message;

function makeChatService(messages: Message[]): ChatService {
  return {
    requireConversation: vi.fn().mockResolvedValue(undefined),
    getConversationMessages: vi.fn().mockResolvedValue(messages),
    deleteMessages: vi.fn().mockResolvedValue(undefined),
  } as unknown as ChatService;
}

function makeSessionManager(hasCtx = true): SessionManager {
  return {
    cancelAllActiveRuns: vi.fn().mockResolvedValue(undefined),
    awaitMaintenance: vi.fn().mockResolvedValue(undefined),
    hasCtx: vi.fn().mockReturnValue(hasCtx),
    getCtx: vi.fn().mockReturnValue({ runtimeConfig: { cf: {} } }),
    activateContext: vi.fn(),
  } as unknown as SessionManager;
}

describe('TruncateChatHandler', () => {
  it('deletes the target message and everything after it, preserving history before it', async () => {
    const messages = [
      msg('hdr', Role.SYSTEM, 'sys'),
      msg('ctx', Role.USER, '<session-context>', { kind: 'context' }),
      msg('m1', Role.USER, 'question 1'),
      msg('a1', Role.ASSIST, 'answer 1'),
      msg('m2', Role.USER, 'question 2'),
      msg('a2', Role.ASSIST, 'answer 2'),
    ];
    const chatService = makeChatService(messages);
    const sessionManager = makeSessionManager();
    const handler = new TruncateChatHandler(chatService, sessionManager);

    await handler.execute(
      new TruncateConversationCommand('conv_1', 'm1', 'user'),
    );

    expect(chatService.deleteMessages).toHaveBeenCalledWith('conv_1', [
      'm1',
      'a1',
      'm2',
      'a2',
    ]);
    // session-context / SYSTEM 头保留（在目标之前）。
    expect(chatService.deleteMessages).not.toHaveBeenCalledWith(
      'conv_1',
      expect.arrayContaining(['hdr', 'ctx']),
    );
  });

  it('cancels active runs before deleting, then resets session ctx to the remainder', async () => {
    const messages = [
      msg('hdr', Role.SYSTEM, 'sys'),
      msg('m1', Role.USER, 'q'),
      msg('a1', Role.ASSIST, 'a'),
    ];
    const chatService = makeChatService(messages);
    // After deleteMessages, the repo returns the truncated list.
    (chatService.getConversationMessages as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(messages)
      .mockResolvedValueOnce([msg('hdr', Role.SYSTEM, 'sys')]);
    const sessionManager = makeSessionManager();
    const handler = new TruncateChatHandler(chatService, sessionManager);

    await handler.execute(
      new TruncateConversationCommand('conv_1', 'm1', 'user'),
    );

    const cancelOrder = (
      sessionManager.cancelAllActiveRuns as ReturnType<typeof vi.fn>
    ).mock.invocationCallOrder[0];
    const deleteOrder = (chatService.deleteMessages as ReturnType<typeof vi.fn>)
      .mock.invocationCallOrder[0];
    expect(cancelOrder).toBeLessThan(deleteOrder);

    expect(sessionManager.activateContext).toHaveBeenCalledWith(
      'conv_1',
      [msg('hdr', Role.SYSTEM, 'sys')],
      { cf: {} },
    );
  });

  it('throws MessageNotFoundError for a missing target', async () => {
    const chatService = makeChatService([msg('m1', Role.USER, 'q')]);
    const handler = new TruncateChatHandler(chatService, makeSessionManager());
    await expect(
      handler.execute(
        new TruncateConversationCommand('conv_1', 'missing', 'user'),
      ),
    ).rejects.toBeInstanceOf(MessageNotFoundError);
  });

  it('skips ctx reset when the session has no context', async () => {
    const chatService = makeChatService([msg('m1', Role.USER, 'q')]);
    const sessionManager = makeSessionManager(false);
    const handler = new TruncateChatHandler(chatService, sessionManager);
    await handler.execute(
      new TruncateConversationCommand('conv_1', 'm1', 'user'),
    );
    expect(sessionManager.activateContext).not.toHaveBeenCalled();
  });
});
