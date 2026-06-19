import { describe, it, expect, vi } from 'vitest';
import { CancelChatHandler } from '@/server/modules/conversation/application/command/cancel-chat.handler';
import type { SessionManager } from '@/server/modules/conversation/application/service/session-manager';
import { CancelChatCommand } from '@/server/modules/conversation/contracts';
import {
  NoActiveRunError,
  SessionNotFoundError,
} from '@/server/modules/conversation/domain/errors';

function makeSessionManager(
  overrides: Partial<SessionManager> = {},
): SessionManager {
  return {
    hasSession: vi.fn().mockReturnValue(true),
    hasActiveRun: vi.fn().mockReturnValue(true),
    cancelActiveRun: vi.fn(),
    cancelAllActiveRuns: vi.fn(),
    ...overrides,
  } as unknown as SessionManager;
}

describe('CancelChatHandler', () => {
  it('throws NoActiveRunError when cancelling a message with no active run', async () => {
    const sessionManager = makeSessionManager({
      hasActiveRun: vi.fn().mockReturnValue(false),
    });
    const handler = new CancelChatHandler(sessionManager);

    await expect(
      handler.execute(
        new CancelChatCommand('conv_1', 'msg_1', 'Cancelled by user'),
      ),
    ).rejects.toBeInstanceOf(NoActiveRunError);

    expect(sessionManager.cancelActiveRun).not.toHaveBeenCalled();
  });

  it('delegates to cancelActiveRun when active run exists', async () => {
    const sessionManager = makeSessionManager();
    const handler = new CancelChatHandler(sessionManager);

    await handler.execute(new CancelChatCommand('conv_1', 'msg_1', 'user'));

    expect(sessionManager.cancelActiveRun).toHaveBeenCalledWith(
      'conv_1',
      'msg_1',
      'user',
    );
    expect(sessionManager.cancelAllActiveRuns).not.toHaveBeenCalled();
  });

  it('throws SessionNotFoundError when cancelling all with no session', async () => {
    const sessionManager = makeSessionManager({
      hasSession: vi.fn().mockReturnValue(false),
    });
    const handler = new CancelChatHandler(sessionManager);

    await expect(
      handler.execute(
        new CancelChatCommand('conv_1', undefined, 'Cancelled by user'),
      ),
    ).rejects.toBeInstanceOf(SessionNotFoundError);

    expect(sessionManager.cancelAllActiveRuns).not.toHaveBeenCalled();
  });

  it('delegates to cancelAllActiveRuns when session exists', async () => {
    const sessionManager = makeSessionManager();
    const handler = new CancelChatHandler(sessionManager);

    await handler.execute(new CancelChatCommand('conv_1', undefined, 'user'));

    expect(sessionManager.cancelAllActiveRuns).toHaveBeenCalledWith(
      'conv_1',
      'user',
    );
  });
});
