import { tool } from '@/server/decorator/core';
import { input } from '@/server/decorator/param';
import { inject } from 'tsyringe';
import { CacheService } from '@/server/modules/memory/services/cache.service';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import { ToolConfig } from '@/shared/types';
import type { ToolProgress } from '@/server/modules/agent/domain/tool-call.entity';
import type { ToolCall } from '@/server/modules/agent/domain/tool-call.entity';
import { Tool } from '@/server/modules/agent/domain/tool.base';

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
    toolCall: ToolCall,
  ): AsyncGenerator<ToolProgress, CachedReadOutput, void> {
    const result = await this.cacheService.readFile(
      toolCall.workDir,
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
