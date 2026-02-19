import { tool } from '@/server/decorator/core';
import { input } from '@/server/decorator/param';
import type { Logger } from '@/server/utils/logger';
import { InjectTokens, ToolIds } from '@/shared/constants';
import { ToolConfig, ToolEvent } from '@/shared/types';
import { sleep } from '@/shared/utils';
import { JSONSchemaType } from 'ajv';
import type { RedisClientType } from 'redis';
import { inject } from 'tsyringe';
import { Tool } from '..';
import { ExecutionContext } from '../../context';

const REDIS_PREFIX = 'human_input:';

export interface HumanInTheLoopInput {
  message: string;
  formSchema: JSONSchemaType<unknown>;
  timeout?: number;
}

export interface HumanInTheLoopOutput {
  submitted: boolean;
  data?: Record<string, unknown>;
}

function calculateBackoffDelay(
  attempt: number,
  baseMs: number = 60000,
  maxMs: number = 1800000,
): number {
  return Math.min(maxMs, baseMs * Math.pow(2, attempt));
}

@tool(ToolIds.HUMAN_IN_THE_LOOP)
export default class HumanInTheLoopTool extends Tool<
  HumanInTheLoopInput,
  HumanInTheLoopOutput
> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  constructor(
    @inject(InjectTokens.REDIS)
    private redis: RedisClientType<any>,
  ) {
    super();
  }

  async *call(
    @input() params: HumanInTheLoopInput,
    ctx: ExecutionContext,
  ): AsyncGenerator<ToolEvent, HumanInTheLoopOutput, void> {
    const { message, formSchema, timeout = 360_0000 } = params;
    const conversationId = ctx.message.conversationId;
    const key = `${REDIS_PREFIX}${conversationId}`;

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

    yield ctx.toolProgressEvent(this.id, {
      status: 'awaiting_input',
      conversationId,
      message,
      schema: formSchema,
    });

    const startTime = Date.now();
    let attempt = 0;

    while (true) {
      const elapsed = Date.now() - startTime;

      if (elapsed >= timeout) {
        break;
      }

      const delay = calculateBackoffDelay(attempt);
      const waitTime = Math.min(delay, timeout - elapsed);
      await sleep(waitTime);

      ctx.signal.throwIfAborted();

      const data = await this.redis.get(key);
      if (data) {
        const pending = JSON.parse(data);
        if (pending.submitted) {
          await this.redis.del(key);
          this.logger.info(
            `HumanInTheLoop request submitted: ${conversationId}`,
          );

          const output: HumanInTheLoopOutput = {
            submitted: true,
            data: pending.result,
          };

          yield ctx.toolResultEvent(this.id, output);
          return output;
        }
      }

      attempt++;
    }

    await this.redis.del(key);
    this.logger.info(`HumanInTheLoop request timeout: ${conversationId}`);

    const output: HumanInTheLoopOutput = {
      submitted: false,
    };

    yield ctx.toolResultEvent(this.id, output);
    return output;
  }
}

