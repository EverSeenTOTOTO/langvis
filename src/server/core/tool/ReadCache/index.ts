import { tool } from '@/server/decorator/core';
import { input } from '@/server/decorator/param';
import { inject } from 'tsyringe';
import { CacheService } from '@/server/service/CacheService';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import { ToolConfig, AgentEvent } from '@/shared/types';
import { Tool } from '..';
import { ExecutionContext } from '../../ExecutionContext';
import { TraceContext } from '../../TraceContext';

export interface ReadCacheInput {
  key: string;
  offset?: number;
  limit?: number;
}

export type ReadCacheOutput = string | Record<string, unknown>;

@tool(ToolIds.CACHED_READ)
export default class ReadCacheTool extends Tool<
  ReadCacheInput,
  ReadCacheOutput
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
    @input() readCacheInput: ReadCacheInput,
    ctx: ExecutionContext,
  ): AsyncGenerator<AgentEvent, ReadCacheOutput, void> {
    const conversationId = TraceContext.getOrFail().conversationId!;

    const result = await this.cacheService.readFile(
      conversationId,
      readCacheInput.key,
      readCacheInput.offset,
      readCacheInput.limit,
    );

    if (typeof result === 'string') {
      yield ctx.agentToolProgressEvent(this.id, { size: result.length });
    } else {
      yield ctx.agentToolProgressEvent(this.id, { type: 'object' });
    }

    return result;
  }

  override summarizeArgs(args: Record<string, unknown>): string {
    const key = typeof args.key === 'string' ? args.key : '';
    return `(${key})`;
  }
}
