import { SubmitHumanInputRequestDto } from '@/shared/dto/controller';
import { InjectTokens, RedisKeys } from '@/shared/constants';
import { api } from '@/server/decorator/api';
import { controller } from '@/server/decorator/controller';
import { body, param, response } from '@/server/decorator/param';
import { inject } from 'tsyringe';
import type { RedisClientType } from 'redis';
import type { Response } from 'express';

// Lua script for atomic check-and-set
// Returns: 1 if success, 0 if already submitted, -1 if not found
const SUBMIT_LUA_SCRIPT = `
local key = KEYS[1]
local data = redis.call('GET', key)
if not data then
  return {-1, ''}
end
local pending = cjson.decode(data)
if pending.submitted then
  return {0, ''}
end
pending.submitted = true
pending.result = cjson.decode(ARGV[1])
redis.call('SET', key, cjson.encode(pending))
redis.call('PUBLISH', key, 'submitted')
return {1, cjson.encode(pending)}
`;

@controller('/api/human-input')
export default class HumanInputController {
  constructor(
    @inject(InjectTokens.REDIS)
    private redis: RedisClientType<any>,
  ) {}

  @api('/:conversationId', { method: 'post' })
  async submitInput(
    @param('conversationId') conversationId: string,
    @body() dto: SubmitHumanInputRequestDto,
    @response() res: Response,
  ) {
    const key = RedisKeys.HUMAN_INPUT(conversationId);

    // Use Lua script for atomic check-and-set
    const result = (await this.redis.eval(SUBMIT_LUA_SCRIPT, {
      keys: [key],
      arguments: [JSON.stringify(dto.data)],
    })) as [number, string];

    const [code] = result;

    if (code === -1) {
      return res.status(404).json({
        success: false,
        error: 'Request not found or expired',
      });
    }

    if (code === 0) {
      return res.status(400).json({
        success: false,
        error: 'Request already submitted',
      });
    }

    return res.json({ success: true });
  }

  @api('/:conversationId', { method: 'get' })
  async getStatus(
    @param('conversationId') conversationId: string,
    @response() res: Response,
  ) {
    const key = RedisKeys.HUMAN_INPUT(conversationId);
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
