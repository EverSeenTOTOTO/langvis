import { InjectTokens } from '@/shared/constants';
import { api } from '@/server/decorator/api';
import { controller } from '@/server/decorator/controller';
import { body, param, response } from '@/server/decorator/param';
import { inject } from 'tsyringe';
import type { RedisClientType } from 'redis';
import type { Response } from 'express';

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
    @response() res: Response,
  ) {
    const key = `${REDIS_PREFIX}${conversationId}`;
    const data = await this.redis.get(key);

    if (!data) {
      return res.status(404).json({
        success: false,
        error: 'Request not found or expired',
      });
    }

    const pending = JSON.parse(data);
    if (pending.submitted) {
      return res.status(400).json({
        success: false,
        error: 'Request already submitted',
      });
    }

    pending.submitted = true;
    pending.result = dto.data;
    await this.redis.set(key, JSON.stringify(pending));

    // Notify waiting tool via Pub/Sub
    await this.redis.publish(key, 'submitted');

    return res.json({ success: true });
  }

  @api('/:conversationId', { method: 'get' })
  async getStatus(
    @param('conversationId') conversationId: string,
    @response() res: Response,
  ) {
    const key = `${REDIS_PREFIX}${conversationId}`;
    const data = await this.redis.get(key);

    if (!data) {
      return res.json({ exists: false });
    }

    const pending = JSON.parse(data);
    return res.json({
      exists: true,
      submitted: pending.submitted,
      message: pending.message,
      schema: pending.formSchema,
    });
  }
}
