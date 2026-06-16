import { container, Lifecycle } from 'tsyringe';
import { EMAIL_REPOSITORY } from './email.di-tokens';
import { EmailRepository } from './infrastructure/persistence/email.repository';

container.register(EMAIL_REPOSITORY, EmailRepository, {
  lifecycle: Lifecycle.Singleton,
});

import './application/command/process-inbound.handler';
import './application/command/archive-email.handler';
import './application/event/email-archived.handler';
