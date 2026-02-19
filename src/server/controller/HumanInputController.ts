import { InjectTokens } from '@/shared/constants';
import { api } from '@/server/decorator/api';
import { controller } from '@/server/decorator/controller';
import { body, param } from '@/server/decorator/param';
import { inject } from 'tsyringe';
import type { RedisClientType } from 'redis';

const REDIS_PREFIX = 'human_input:';

interface SubmitHumanInputDto {
  data: Record<string, unknown>;
}

@controller('/api/human-input')
export default class HumanInputController {
  constructor(
    @inject(InjectTokens.REDIS)
    private redis: RedisClientType<any>,
  ) {}

  @api('/:conversationId', { method: 'post' })
  async submitInput(
    @param('conversationId') conversationId: string,
    @body() dto: SubmitHumanInputDto,
  ) {
    const key = `${REDIS_PREFIX}${conversationId}`;
    const data = await this.redis.get(key);

    if (!data) {
      return {
        success: false,
        error: 'Request not found or expired',
      };
    }

    const pending = JSON.parse(data);
    if (pending.submitted) {
      return {
        success: false,
        error: 'Request already submitted',
      };
    }

    pending.submitted = true;
    pending.result = dto.data;
    await this.redis.set(key, JSON.stringify(pending));

    return { success: true };
  }

  @api('/:conversationId', { method: 'get' })
  async getStatus(@param('conversationId') conversationId: string) {
    const key = `${REDIS_PREFIX}${conversationId}`;
    const data = await this.redis.get(key);

    if (!data) {
      return { exists: false };
    }

    const pending = JSON.parse(data);
    return {
      exists: true,
      submitted: pending.submitted,
      message: pending.message,
      schema: pending.formSchema,
    };
  }
}
