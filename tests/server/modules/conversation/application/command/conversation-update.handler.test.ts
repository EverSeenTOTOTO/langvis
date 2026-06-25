import { describe, it, expect, vi } from 'vitest';
import { ConversationUpdateHandler } from '@/server/modules/conversation/application/command/conversation-update.handler';
import type { ConversationRepositoryPort } from '@/server/modules/conversation/domain/port/conversation.repository.port';
import { ConversationUpdateCommand } from '@/server/modules/conversation/contracts';
import { ConversationNotFoundError } from '@/server/modules/conversation/domain/errors';

function makeRepo(conv: any, updated: any = conv) {
  return {
    findById: vi.fn().mockResolvedValue(conv),
    update: vi.fn().mockResolvedValue(updated),
  } as unknown as ConversationRepositoryPort;
}

const existing = {
  id: 'conv_1',
  userId: 'user_1',
  config: { model: { modelId: 'm1' } },
};

describe('ConversationUpdateHandler', () => {
  it('throws ConversationNotFoundError when conversation missing', async () => {
    const repo = makeRepo(null);
    const handler = new ConversationUpdateHandler(repo);

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
    const handler = new ConversationUpdateHandler(repo);

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
    const handler = new ConversationUpdateHandler(repo);

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
  });
});
