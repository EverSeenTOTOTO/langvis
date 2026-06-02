import { ExceptionBase } from '@/server/libs/exceptions/exception.base';

export class ConversationNotFoundError extends ExceptionBase {
  readonly code = 'CONVERSATION_NOT_FOUND';
  constructor(id: string) {
    super(`Conversation ${id} not found`);
  }
}

export class MessageNotFoundError extends ExceptionBase {
  readonly code = 'MESSAGE_NOT_FOUND';
  constructor(id: string) {
    super(`Message ${id} not found`);
  }
}

export class NoActiveRunError extends ExceptionBase {
  readonly code = 'NO_ACTIVE_RUN';
  constructor(messageId: string) {
    super(`No active run for message ${messageId}`);
  }
}

export class DuplicateRunError extends ExceptionBase {
  readonly code = 'DUPLICATE_RUN';
  constructor(messageId: string) {
    super(`Message ${messageId} already has an active run`);
  }
}
