import { describe, it, expect, vi } from 'vitest';

import { ConversationActivateHandler } from '@/server/modules/conversation/application/command/conversation-activate.handler';
import type { ChatService } from '@/server/modules/conversation/application/service/chat.service';
import type { ConversationRepositoryPort } from '@/server/modules/conversation/domain/port/conversation.repository.port';
import type { EventBus } from '@/server/libs/ddd';
import { ConversationActivateCommand } from '@/server/modules/conversation/contracts';
import {
  ConversationForbiddenError,
  ConversationNotFoundError,
} from '@/server/modules/conversation/domain/errors';

function makeConvRepo(
  conv: { userId: string; config?: Record<string, unknown> } | null,
): ConversationRepositoryPort {
  return {
    findById: vi.fn().mockResolvedValue(conv),
  } as unknown as ConversationRepositoryPort;
}

const stubChatService = { activate: vi.fn().mockResolvedValue(undefined) };
const stubEventBus = { dispatch: vi.fn() };
const stubAgentService = {
  getSystemPrompt: vi.fn(() => Promise.resolve('')),
};

function makeHandler(conv: any) {
  return new ConversationActivateHandler(
    stubChatService as unknown as ChatService,
    makeConvRepo(conv),
    stubEventBus as unknown as EventBus,
    stubAgentService as any,
  );
}

describe('ConversationActivateHandler', () => {
  it('throws ConversationNotFoundError when conversation missing', async () => {
    const handler = makeHandler(null);

    await expect(
      handler.execute(new ConversationActivateCommand('conv_1', 'user_1')),
    ).rejects.toBeInstanceOf(ConversationNotFoundError);
  });

  it('throws ConversationForbiddenError on ownership mismatch', async () => {
    const handler = makeHandler({ userId: 'owner_1', config: {} });

    await expect(
      handler.execute(new ConversationActivateCommand('conv_1', 'intruder')),
    ).rejects.toBeInstanceOf(ConversationForbiddenError);
  });
});
