import { tool } from '@/server/decorator/core';
import { input } from '@/server/decorator/param';
import type { Logger } from '@/server/utils/logger';
import { RedisKeys, ToolIds } from '@/shared/constants';
import { ToolConfig, AgentEvent } from '@/shared/types';
import { JSONSchemaType } from 'ajv';
import type { RedisClientType } from 'redis';
import { Tool } from '..';
import { ExecutionContext } from '../../ExecutionContext';
import { RedisService } from '../../../service/RedisService';
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

export interface HumanInTheLoopInput<I = Record<string, any>> {
  conversationId: string;
  message: string;
  formSchema: JSONSchemaType<I>;
  timeout?: number;
}

export interface HumanInTheLoopOutput<O = Record<string, any>> {
  submitted: boolean;
  data?: O;
}

@tool(ToolIds.ASK_USER)
export default class HumanInTheLoopTool<
  I = Record<string, any>,
  O = Record<string, any>,
> extends Tool<HumanInTheLoopInput<I>, HumanInTheLoopOutput<O>> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  constructor(@inject(RedisService) private redisService: RedisService) {
    super();
  }

  async *call(
    @input() params: HumanInTheLoopInput<I>,
    ctx: ExecutionContext,
  ): AsyncGenerator<AgentEvent, HumanInTheLoopOutput<O>, void> {
    ctx.signal.throwIfAborted();

    const { conversationId, message, formSchema, timeout = 300_000 } = params;
    const key = RedisKeys.HUMAN_INPUT(conversationId);
    const POLL_INTERVAL = 30_000; // 30s fallback check when Pub/Sub fails

    await this.redisService.set(key, {
      conversationId,
      formSchema,
      message,
      submitted: false,
      createdAt: Date.now(),
    });

    this.logger.info(`HumanInTheLoop request created: ${conversationId}`);

    yield ctx.agentToolProgressEvent(this.id, {
      status: 'awaiting_input',
      conversationId,
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
          ctx.signal,
        );
      } catch (e) {
        if (ctx.signal.aborted) {
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
        this.logger.info(`HumanInTheLoop request submitted: ${conversationId}`);

        const output: HumanInTheLoopOutput<O> = {
          submitted: true,
          data: pending.result,
        };

        return output;
      }
    }

    await this.redisService.del(key);
    this.logger.info(`HumanInTheLoop request timeout: ${conversationId}`);

    const output: HumanInTheLoopOutput<O> = {
      submitted: false,
    };

    return output;
  }
}
