import { tool } from '@/server/decorator/core';
import { input } from '@/server/decorator/param';
import type { Logger } from '@/server/utils/logger';
import { InjectTokens, ToolIds } from '@/shared/constants';
import { ToolConfig, AgentEvent } from '@/shared/types';
import { JSONSchemaType } from 'ajv';
import type { RedisClientType } from 'redis';
import { inject } from 'tsyringe';
import { Tool } from '..';
import { ExecutionContext } from '../../ExecutionContext';

const REDIS_PREFIX = 'human_input:';

function waitForNotification(
  subscriber: RedisClientType<any>,
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

@tool(ToolIds.HUMAN_IN_THE_LOOP)
export default class HumanInTheLoopTool<
  I = Record<string, any>,
  O = Record<string, any>,
> extends Tool<HumanInTheLoopInput<I>, HumanInTheLoopOutput<O>> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  constructor(
    @inject(InjectTokens.REDIS)
    private redis: RedisClientType<any>,
    @inject(InjectTokens.REDIS_SUBSCRIBER)
    private redisSubscriber: RedisClientType<any>,
  ) {
    super();
  }

  async *call(
    @input() params: HumanInTheLoopInput<I>,
    ctx: ExecutionContext,
  ): AsyncGenerator<AgentEvent, HumanInTheLoopOutput<O>, void> {
    ctx.signal.throwIfAborted();

    const { conversationId, message, formSchema, timeout = 300_000 } = params;
    const key = `${REDIS_PREFIX}${conversationId}`;
    const POLL_INTERVAL = 30_000; // 30s fallback check when Pub/Sub fails

    await this.redis.set(
      key,
      JSON.stringify({
        conversationId,
        formSchema,
        message,
        submitted: false,
        createdAt: Date.now(),
      }),
    );

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
          this.redisSubscriber,
          key,
          waitTime,
          ctx.signal,
        );
      } catch (e) {
        if (ctx.signal.aborted) {
          await this.redis.del(key);
          throw e;
        }
      }

      // Check Redis (works for both submitted and timeout cases)
      const data = await this.redis.get(key);
      if (data) {
        const pending = JSON.parse(data);
        if (pending.submitted) {
          await this.redis.del(key);
          this.logger.info(
            `HumanInTheLoop request submitted: ${conversationId}`,
          );

          const output: HumanInTheLoopOutput<O> = {
            submitted: true,
            data: pending.result,
          };

          return output;
        }
      }
    }

    await this.redis.del(key);
    this.logger.info(`HumanInTheLoop request timeout: ${conversationId}`);

    const output: HumanInTheLoopOutput<O> = {
      submitted: false,
    };

    return output;
  }
}
