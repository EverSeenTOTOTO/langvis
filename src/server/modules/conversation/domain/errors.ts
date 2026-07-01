import { ExceptionBase } from '@/server/libs/exceptions/exception.base';

export class ConversationNotFoundError extends ExceptionBase {
  readonly code = 'CONVERSATION_NOT_FOUND';
  readonly statusCode = 404;
  constructor(id: string) {
    super(`Conversation ${id} not found`);
  }
}

export class MessageNotFoundError extends ExceptionBase {
  readonly code = 'MESSAGE_NOT_FOUND';
  readonly statusCode = 404;
  constructor(id: string) {
    super(`Message ${id} not found`);
  }
}

export class NoActiveRunError extends ExceptionBase {
  readonly code = 'NO_ACTIVE_RUN';
  readonly statusCode = 404;
  constructor(messageId: string) {
    super(`No active run for message ${messageId}`);
  }
}

export class DuplicateRunError extends ExceptionBase {
  readonly code = 'DUPLICATE_RUN';
  readonly statusCode = 409;
  constructor(messageId: string) {
    super(`Message ${messageId} already has an active run`);
  }
}

export class ConversationNotActivatedError extends ExceptionBase {
  readonly code = 'CONVERSATION_NOT_ACTIVATED';
  readonly statusCode = 400;
  constructor(conversationId: string) {
    super(`Conversation ${conversationId} is not activated`);
  }
}

export class SessionNotFoundError extends ExceptionBase {
  readonly code = 'SESSION_NOT_FOUND';
  readonly statusCode = 404;
  constructor(conversationId: string) {
    super(`No active session for conversation ${conversationId}`);
  }
}
