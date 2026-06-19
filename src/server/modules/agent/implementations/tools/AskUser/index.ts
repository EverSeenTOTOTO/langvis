import { tool } from '@/server/decorator/core';
import type { Logger } from '@/server/utils/logger';
import { RedisKeys, ToolIds } from '@/shared/constants';
import type { ToolConfig } from '@/shared/types';
import { JSONSchemaType } from 'ajv';
import type { RedisClientType } from 'redis';
import type { ToolCall } from '@/server/modules/agent/domain/model/tool-call.entity';
import type { EnrichedEvent } from '@/shared/types/events';
import { Tool } from '@/server/modules/agent/domain/model/tool.base';
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

export interface AskUserInput {
  message: string;
  formSchema: JSONSchemaType<Record<string, any>>;
  timeout?: number;
}

export interface AskUserOutput {
  submitted: boolean;
  data?: Record<string, any>;
}

@tool(ToolIds.ASK_USER)
export default class AskUserTool extends Tool<AskUserOutput> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  constructor(@inject(RedisService) private redisService: RedisService) {
    super();
  }

  async *call(
    toolCall: ToolCall,
  ): AsyncGenerator<EnrichedEvent, AskUserOutput, void> {
    toolCall.signal.throwIfAborted();

    const messageId = toolCall.messageId;

    const params = toolCall.input as unknown as AskUserInput;
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

    yield toolCall.emitProgress({
      status: 'awaiting_input',
      messageId,
      message,
      schema: formSchema,
    });

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
        result?: Record<string, any>;
      }>(key);
      if (pending?.submitted) {
        await this.redisService.del(key);
        this.logger.info(`AskUser request submitted: ${messageId}`);

        const output: AskUserOutput = {
          submitted: true,
          data: pending.result,
        };

        return output;
      }
    }

    await this.redisService.del(key);
    this.logger.info(`AskUser request timeout: ${messageId}`);

    const output: AskUserOutput = {
      submitted: false,
    };

    return output;
  }
}
