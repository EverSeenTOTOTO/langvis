import { tool } from '@/server/decorator/core';
import { input } from '@/server/decorator/param';
import type { Logger } from '@/server/utils/logger';
import { RedisKeys, ToolIds } from '@/shared/constants';
import type { ToolConfig } from '@/shared/types';
import { JSONSchemaType } from 'ajv';
import type { RedisClientType } from 'redis';
import type { ToolProgress } from '@/server/modules/agent/domain/tool-call.entity';
import type { ToolCall } from '@/server/modules/agent/domain/tool-call.entity';
import { Tool } from '@/server/modules/agent/domain/tool.base';
import { RedisService } from '@/server/libs/infrastructure/redis.service';
import { inject } from 'tsyringe';

function waitForNotification(
  subscriber: RedisClientType,
  channel: string,
  timeout: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeoutId);
      subscriber.unsubscribe(channel).catch(() => {});
      reject(signal.reason);
    };

    const timeoutId = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      subscriber.unsubscribe(channel).catch(() => {});
      resolve();
    }, timeout);

    signal.addEventListener('abort', onAbort, { once: true });

    subscriber
      .subscribe(channel, message => {
        if (message === 'submitted') {
          clearTimeout(timeoutId);
          signal.removeEventListener('abort', onAbort);
          subscriber.unsubscribe(channel).catch(() => {});
          resolve();
        }
      })
      .catch(err => {
        clearTimeout(timeoutId);
        signal.removeEventListener('abort', onAbort);
        reject(err);
      });
  });
}

export interface AskUserInput<I = Record<string, any>> {
  message: string;
  formSchema: JSONSchemaType<I>;
  timeout?: number;
}

export interface AskUserOutput<O = Record<string, any>> {
  submitted: boolean;
  data?: O;
}

@tool(ToolIds.ASK_USER)
export default class AskUserTool<
  I = Record<string, any>,
  O = Record<string, any>,
> extends Tool<AskUserInput<I>, AskUserOutput<O>> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  constructor(@inject(RedisService) private redisService: RedisService) {
    super();
  }

  async *call(
    @input() params: AskUserInput<I>,
    toolCall: ToolCall,
  ): AsyncGenerator<ToolProgress, AskUserOutput<O>, void> {
    toolCall.signal.throwIfAborted();

    const messageId = toolCall.messageId;

    const { message, formSchema, timeout = 300_000 } = params;
    const key = RedisKeys.HUMAN_INPUT(messageId);
    const POLL_INTERVAL = 30_000; // 30s fallback check when Pub/Sub fails

    await this.redisService.set(key, {
      messageId,
      formSchema,
      message,
      submitted: false,
      createdAt: Date.now(),
    });

    this.logger.info(`AskUser request created: ${messageId}`);

    yield {
      type: 'tool_progress' as const,
      data: {
        status: 'awaiting_input',
        messageId,
        message,
        schema: formSchema,
      },
    };

    const startTime = Date.now();

    while (true) {
      const elapsed = Date.now() - startTime;
      if (elapsed >= timeout) {
        break;
      }

      const remainingTime = timeout - elapsed;
      const waitTime = Math.min(POLL_INTERVAL, remainingTime);

      try {
        await waitForNotification(
          this.redisService.subscriber,
          key,
          waitTime,
          toolCall.signal,
        );
      } catch (e) {
        if (toolCall.signal.aborted) {
          await this.redisService.del(key);
          throw e;
        }
      }

      // Check Redis (works for both submitted and timeout cases)
      const pending = await this.redisService.get<{
        submitted: boolean;
        result?: O;
      }>(key);
      if (pending?.submitted) {
        await this.redisService.del(key);
        this.logger.info(`AskUser request submitted: ${messageId}`);

        const output: AskUserOutput<O> = {
          submitted: true,
          data: pending.result,
        };

        return output;
      }
    }

    await this.redisService.del(key);
    this.logger.info(`AskUser request timeout: ${messageId}`);

    const output: AskUserOutput<O> = {
      submitted: false,
    };

    return output;
  }
}
