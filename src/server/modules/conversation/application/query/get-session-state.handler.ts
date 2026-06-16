import { inject } from 'tsyringe';
import { queryHandler } from '@/server/decorator/handler';
import { RedisService } from '@/server/libs/infrastructure/redis.service';
import { RedisKeys } from '@/shared/constants';
import type { ChatState } from '../service/conversation.service';
import { GetSessionStateQuery } from '../../contracts';

@queryHandler(GetSessionStateQuery)
export class GetSessionStateHandler {
  constructor(@inject(RedisService) private redisService: RedisService) {}

  async execute(query: GetSessionStateQuery): Promise<ChatState | null> {
    return this.redisService.get<ChatState>(
      RedisKeys.CHAT_SESSION(query.conversationId),
    );
  }
}
