import { RedisKeys } from '@/shared/constants';
import { inject } from 'tsyringe';
import { service } from '@/server/decorator/service';
import { RedisService } from '@/server/libs/infrastructure/redis.service';
import type { ChatSessionState } from '../session-manager';

@service()
export class GetSessionState {
  constructor(@inject(RedisService) private redisService: RedisService) {}

  async execute(conversationId: string): Promise<ChatSessionState | null> {
    return this.redisService.get<ChatSessionState>(
      RedisKeys.CHAT_SESSION(conversationId),
    );
  }
}
