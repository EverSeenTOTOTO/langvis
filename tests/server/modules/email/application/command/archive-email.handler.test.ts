import { describe, it, expect, vi } from 'vitest';
import { ArchiveEmailHandler } from '@/server/modules/email/application/command/archive-email.handler';
import type { EmailService } from '@/server/modules/email/application/service/email.service';
import type { ProviderService } from '@/server/libs/infrastructure/provider.service';
import type { CommandBus, EventBus } from '@/server/libs/ddd';
import { CreateConversationCommand } from '@/server/modules/conversation/contracts';
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
  const commandBus = {
    execute: vi.fn().mockResolvedValue({ id: 'conv_1' }),
  } as unknown as CommandBus;
  const providerService = {
    getDefaultModel: vi.fn().mockReturnValue({ id: 'model_1' }),
  } as unknown as ProviderService;
  const eventBus = { dispatch: vi.fn() } as unknown as EventBus;
  return { emailService, commandBus, providerService, eventBus };
}

describe('ArchiveEmailHandler', () => {
  it('throws EmailNotFoundError when email missing (no conversation created)', async () => {
    const { emailService, commandBus, providerService, eventBus } =
      makeDeps(null);
    const handler = new ArchiveEmailHandler(
      emailService,
      commandBus,
      providerService,
      eventBus,
    );

    await expect(
      handler.execute(new ArchiveEmailCommand('mail_1', 'user_1')),
    ).rejects.toBeInstanceOf(EmailNotFoundError);

    expect(emailService.updateStatus).not.toHaveBeenCalled();
    expect(commandBus.execute).not.toHaveBeenCalled();
  });

  it('creates conversation via CreateConversationCommand (no repo reach), dispatches EmailArchived, returns both ids', async () => {
    const { emailService, commandBus, providerService, eventBus } = makeDeps();
    const handler = new ArchiveEmailHandler(
      emailService,
      commandBus,
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
    expect(commandBus.execute).toHaveBeenCalledTimes(1);
    const cmd = (commandBus.execute as any).mock.calls[0][0];
    expect(cmd).toBeInstanceOf(CreateConversationCommand);
    expect(cmd.name).toBe('归档邮件: Hello');
    expect(cmd.userId).toBe('user_1');
    expect(cmd.config).toEqual({ model: { modelId: 'model_1' } });
    expect(cmd.groupName).toBe('Email Archive');
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
