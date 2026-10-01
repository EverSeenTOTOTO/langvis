import { Inject } from '@nestjs/common';
import { QueryHandler } from '@nestjs/cqrs';
import type { ChatState } from '../service/session-manager';
import { SessionManager } from '../service/session-manager';
import { GetSessionStateQuery } from '../../contracts';

@QueryHandler(GetSessionStateQuery)
export class GetSessionStateHandler {
  constructor(@Inject(SessionManager) private sessionManager: SessionManager) {}

  execute(query: GetSessionStateQuery): ChatState | null {
    return this.sessionManager.getSessionState(query.conversationId);
  }
}
