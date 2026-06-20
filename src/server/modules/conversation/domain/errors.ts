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

export class ConversationForbiddenError extends ExceptionBase {
  readonly code = 'CONVERSATION_FORBIDDEN';
  readonly statusCode = 403;
  constructor(conversationId: string, userId: string) {
    super(`Conversation ${conversationId} does not belong to user ${userId}`);
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

export class AgentImmutableError extends ExceptionBase {
  readonly code = 'AGENT_IMMUTABLE';
  readonly statusCode = 409;
  constructor(conversationId: string) {
    super(
      `Agent of conversation ${conversationId} is immutable after creation`,
    );
  }
}
