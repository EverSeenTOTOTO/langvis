import { inject } from 'tsyringe';
import { service } from '@/server/decorator/service';
import { RedisService } from '@/server/libs/infrastructure/redis.service';
import { RedisKeys } from '@/shared/constants';
import type { ChatSessionState } from '../session-manager';
import { GetSessionStateQuery } from './get-session-state.query';

@service()
export class GetSessionStateHandler {
  constructor(@inject(RedisService) private redisService: RedisService) {}

  async execute(query: GetSessionStateQuery): Promise<ChatSessionState | null> {
    return this.redisService.get<ChatSessionState>(
      RedisKeys.CHAT_SESSION(query.conversationId),
    );
  }
}
