import { inject } from 'tsyringe';
import { singleton } from 'tsyringe';
import { RedisService } from '@/server/libs/infrastructure/redis.service';
import { RedisKeys } from '@/shared/constants';
import type { HumanInputPort } from '../domain/port/human-input.port';
import type { MessageRepositoryPort } from '../domain/port/message.repository.port';
import { MESSAGE_REPOSITORY } from '../conversation.di-tokens';

// Atomic check-and-set via Lua; returns 1 success / 0 already submitted / -1 not found.
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
  constructor(
    @inject(RedisService) private redisService: RedisService,
    @inject(MESSAGE_REPOSITORY) private messageRepo: MessageRepositoryPort,
  ) {}

  /** HTTP 端点以 :messageId 寻址；AskUser 写 pending 时用 runId 做 key —— 边界翻译在此。 */
  private async resolveKey(messageId: string): Promise<string | null> {
    const message = await this.messageRepo.findById(messageId);
    return message?.agentRunId
      ? RedisKeys.HUMAN_INPUT(message.agentRunId)
      : null;
  }

  async submit(
    messageId: string,
    data: Record<string, unknown>,
  ): Promise<'not_found' | 'already_submitted' | 'success'> {
    const key = await this.resolveKey(messageId);
    if (!key) return 'not_found';

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
    const key = await this.resolveKey(messageId);
    if (!key) return null;
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
