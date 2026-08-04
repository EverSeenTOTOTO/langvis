import { inject } from 'tsyringe';
import { queryHandler } from '@/server/decorator/handler';
import type { ChatState } from '../service/session-manager';
import { SessionManager } from '../service/session-manager';
import { GetSessionStateQuery } from '../../contracts';

@queryHandler(GetSessionStateQuery)
export class GetSessionStateHandler {
  constructor(@inject(SessionManager) private sessionManager: SessionManager) {}

  execute(query: GetSessionStateQuery): ChatState | null {
    return this.sessionManager.getSessionState(query.conversationId);
  }
}
