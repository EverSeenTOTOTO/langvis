import { tool } from '@/server/decorator/core';
import { input } from '@/server/decorator/param';
import { resolve } from '@/server/utils/cache';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import { ToolConfig, AgentEvent } from '@/shared/types';
import { Tool } from '..';
import { ExecutionContext } from '../../ExecutionContext';

export interface ReadCacheInput {
  key: string;
  offset?: number;
  limit?: number;
}

export type ReadCacheOutput = string | Record<string, unknown>;

@tool(ToolIds.READ_CACHE)
export default class ReadCacheTool extends Tool<
  ReadCacheInput,
  ReadCacheOutput
> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  async *call(
    @input() readCacheInput: ReadCacheInput,
    ctx: ExecutionContext,
  ): AsyncGenerator<AgentEvent, ReadCacheOutput, void> {
    const content = await resolve(ctx.traceId, { $cached: readCacheInput.key });

    if (typeof content === 'string') {
      const offset = readCacheInput.offset ?? 0;
      const limit = readCacheInput.limit;
      const result = limit
        ? content.slice(offset, offset + limit)
        : content.slice(offset);

      yield ctx.agentToolProgressEvent(this.id, { size: result.length });
      return result;
    }

    yield ctx.agentToolProgressEvent(this.id, { type: 'object' });
    return content as Record<string, unknown>;
  }
}
