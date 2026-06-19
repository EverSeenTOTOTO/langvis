import { inject } from 'tsyringe';
import { singleton } from 'tsyringe';
import { RedisService } from '@/server/libs/infrastructure/redis.service';
import { RedisKeys } from '@/shared/constants';
import type { HumanInputPort } from '../domain/port/human-input.port';

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

@singleton()
export class HumanInputRedisProvider implements HumanInputPort {
  constructor(@inject(RedisService) private redisService: RedisService) {}

  async submit(
    messageId: string,
    data: Record<string, unknown>,
  ): Promise<'not_found' | 'already_submitted' | 'success'> {
    const key = RedisKeys.HUMAN_INPUT(messageId);

    const result = (await this.redisService.client.eval(SUBMIT_LUA_SCRIPT, {
      keys: [key],
      arguments: [JSON.stringify(data)],
    })) as [number, string];

    const [code] = result;

    if (code === -1) return 'not_found';
    if (code === 0) return 'already_submitted';
    return 'success';
  }

  async getStatus(messageId: string): Promise<{
    exists: boolean;
    submitted: boolean;
    message: string;
    schema: unknown;
  } | null> {
    const key = RedisKeys.HUMAN_INPUT(messageId);
    const pending = await this.redisService.get<{
      submitted: boolean;
      message: string;
      formSchema: unknown;
    }>(key);

    if (!pending) return null;

    return {
      exists: true,
      submitted: pending.submitted,
      message: pending.message,
      schema: pending.formSchema,
    };
  }
}
