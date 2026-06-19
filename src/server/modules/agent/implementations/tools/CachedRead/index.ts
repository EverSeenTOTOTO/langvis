import { tool } from '@/server/decorator/core';
import { inject } from 'tsyringe';
import { CACHE_SERVICE } from '@/server/modules/agent/agent.di-tokens';
import type { CachePort } from '@/server/modules/agent/domain/port/cache.port';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import { ToolConfig } from '@/shared/types';
import type { ToolCallContext } from '@/server/modules/agent/domain/port/tool-call-context.port';
import { Tool } from '@/server/modules/agent/domain/model/tool.base';
import type { RunEvent } from '@/shared/types/events';

export interface CachedReadInput {
  key: string;
  offset?: number;
  limit?: number;
}

export type CachedReadOutput = string | Record<string, unknown>;

@tool(ToolIds.CACHED_READ)
export default class CachedReadTool extends Tool<CachedReadOutput> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  constructor(@inject(CACHE_SERVICE) private readonly cacheService: CachePort) {
    super();
  }

  async *call(
    ctx: ToolCallContext,
  ): AsyncGenerator<RunEvent, CachedReadOutput, void> {
    const readCacheInput = ctx.input as unknown as CachedReadInput;

    const result = await this.cacheService.readFile(
      ctx.workDir,
      readCacheInput.key,
      readCacheInput.offset,
      readCacheInput.limit,
    );

    if (typeof result === 'string') {
      yield {
        type: 'tool_progress',
        callId: ctx.callId,
        data: { size: result.length },
      };
    } else {
      yield {
        type: 'tool_progress',
        callId: ctx.callId,
        data: { type: 'object' },
      };
    }

    return result;
  }
}
