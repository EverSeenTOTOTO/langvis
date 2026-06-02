import { tool } from '@/server/decorator/core';
import { input } from '@/server/decorator/param';
import { inject } from 'tsyringe';
import { CacheService } from '@/server/modules/memory/adapters/cache.adapter';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import { ToolConfig } from '@/shared/types';
import { Tool } from '@/server/modules/agent/domain/tool.base';
import { TraceContext } from '../../TraceContext';

export interface CachedReadInput {
  key: string;
  offset?: number;
  limit?: number;
}

export type CachedReadOutput = string | Record<string, unknown>;

@tool(ToolIds.CACHED_READ)
export default class CachedReadTool extends Tool<
  CachedReadInput,
  CachedReadOutput
> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  constructor(
    @inject(CacheService) private readonly cacheService: CacheService,
  ) {
    super();
  }

  async *call(
    @input() readCacheInput: CachedReadInput,
    _ctx: { signal: AbortSignal },
  ): AsyncGenerator<
    { type: 'tool_progress'; data: unknown },
    CachedReadOutput,
    void
  > {
    const conversationId = TraceContext.getOrFail().conversationId!;

    const result = await this.cacheService.readFile(
      conversationId,
      readCacheInput.key,
      readCacheInput.offset,
      readCacheInput.limit,
    );

    if (typeof result === 'string') {
      yield { type: 'tool_progress' as const, data: { size: result.length } };
    } else {
      yield { type: 'tool_progress' as const, data: { type: 'object' } };
    }

    return result;
  }

  override summarizeArgs(args: Record<string, unknown>): string {
    const key = typeof args.key === 'string' ? args.key : '';
    return `(${key})`;
  }
}
