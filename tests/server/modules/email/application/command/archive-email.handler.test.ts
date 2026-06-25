import { describe, it, expect, vi } from 'vitest';
import { ArchiveEmailHandler } from '@/server/modules/email/application/command/archive-email.handler';
import type { EmailService } from '@/server/modules/email/application/service/email.service';
import type { ConversationRepositoryPort } from '@/server/modules/conversation/domain/port/conversation.repository.port';
import type { ProviderService } from '@/server/libs/infrastructure/provider.service';
import type { EventBus } from '@/server/libs/ddd';
import {
  ArchiveEmailCommand,
  EmailArchived,
} from '@/server/modules/email/contracts';
import { EmailNotFoundError } from '@/server/modules/email/domain/errors';

function makeEmailService(
  email: {
    subject: string;
    content: string;
    from: string;
    fromName: string | null;
    sentAt: Date;
  } | null,
): EmailService {
  return {
    getById: vi.fn().mockResolvedValue(email),
    updateStatus: vi.fn().mockResolvedValue(true),
  } as unknown as EmailService;
}

const defaultEmail = {
  subject: 'Hello',
  content: 'body',
  from: 'a@b.com',
  fromName: 'A',
  sentAt: new Date('2024-01-01'),
};

function makeDeps(email: typeof defaultEmail | null = defaultEmail) {
  const emailService = makeEmailService(email);
  const convRepo = {
    create: vi.fn().mockResolvedValue({ id: 'conv_1' }),
  } as unknown as ConversationRepositoryPort;
  const providerService = {
    getDefaultModel: vi.fn().mockReturnValue({ id: 'model_1' }),
  } as unknown as ProviderService;
  const eventBus = { dispatch: vi.fn() } as unknown as EventBus;
  return { emailService, convRepo, providerService, eventBus };
}

describe('ArchiveEmailHandler', () => {
  it('throws EmailNotFoundError when email missing', async () => {
    const { emailService, convRepo, providerService, eventBus } =
      makeDeps(null);
    const handler = new ArchiveEmailHandler(
      emailService,
      convRepo,
      providerService,
      eventBus,
    );

    await expect(
      handler.execute(new ArchiveEmailCommand('mail_1', 'user_1')),
    ).rejects.toBeInstanceOf(EmailNotFoundError);

    expect(emailService.updateStatus).not.toHaveBeenCalled();
    expect(convRepo.create).not.toHaveBeenCalled();
  });

  it('creates the conversation synchronously, dispatches EmailArchived, and returns both ids', async () => {
    const { emailService, convRepo, providerService, eventBus } = makeDeps();
    const handler = new ArchiveEmailHandler(
      emailService,
      convRepo,
      providerService,
      eventBus,
    );

    const result = await handler.execute(
      new ArchiveEmailCommand('mail_1', 'user_1'),
    );

    expect(emailService.updateStatus).toHaveBeenCalledWith(
      'mail_1',
      'archived',
    );
    expect(convRepo.create).toHaveBeenCalledWith(
      '归档邮件: Hello',
      'user_1',
      expect.objectContaining({
        model: expect.any(Object),
      }),
      null,
      'Email Archive',
    );
    expect(eventBus.dispatch).toHaveBeenCalledWith(
      EmailArchived,
      expect.objectContaining({
        aggregateId: 'mail_1',
        payload: expect.objectContaining({
          emailId: 'mail_1',
          conversationId: 'conv_1',
        }),
      }),
    );
    expect(result).toEqual({ emailId: 'mail_1', conversationId: 'conv_1' });
  });
});
