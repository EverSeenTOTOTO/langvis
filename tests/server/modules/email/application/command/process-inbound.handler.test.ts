import { describe, it, expect, vi } from 'vitest';
import { ProcessInboundHandler } from '@/server/modules/email/application/command/process-inbound.handler';
import type { EmailService } from '@/server/modules/email/application/service/email.service';
import { ProcessInboundCommand } from '@/server/modules/email/contracts';
import { MissingRawEmailContentError } from '@/server/modules/email/domain/errors';

function makeEmailService(): EmailService {
  return {
    processInbound: vi.fn().mockResolvedValue({ success: true }),
  } as unknown as EmailService;
}

describe('ProcessInboundHandler', () => {
  it('throws MissingRawEmailContentError when raw is empty', async () => {
    const emailService = makeEmailService();
    const handler = new ProcessInboundHandler(emailService);

    await expect(
      handler.execute(new ProcessInboundCommand('')),
    ).rejects.toBeInstanceOf(MissingRawEmailContentError);

    expect(emailService.processInbound).not.toHaveBeenCalled();
  });

  it('delegates to emailService when raw is present', async () => {
    const emailService = makeEmailService();
    const handler = new ProcessInboundHandler(emailService);

    await handler.execute(new ProcessInboundCommand('raw content'));

    expect(emailService.processInbound).toHaveBeenCalledWith('raw content');
  });
});
