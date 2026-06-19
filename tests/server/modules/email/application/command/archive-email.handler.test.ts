import { describe, it, expect, vi } from 'vitest';
import { ArchiveEmailHandler } from '@/server/modules/email/application/command/archive-email.handler';
import type { EmailService } from '@/server/modules/email/application/service/email.service';
import type { EventBus } from '@/server/libs/ddd';
import { ArchiveEmailCommand } from '@/server/modules/email/contracts';
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

const stubEventBus = { dispatch: vi.fn() } as unknown as EventBus;

describe('ArchiveEmailHandler', () => {
  it('throws EmailNotFoundError when email missing', async () => {
    const emailService = makeEmailService(null);
    const handler = new ArchiveEmailHandler(emailService, stubEventBus);

    await expect(
      handler.execute(new ArchiveEmailCommand('mail_1', 'user_1')),
    ).rejects.toBeInstanceOf(EmailNotFoundError);

    expect(emailService.updateStatus).not.toHaveBeenCalled();
  });
});
