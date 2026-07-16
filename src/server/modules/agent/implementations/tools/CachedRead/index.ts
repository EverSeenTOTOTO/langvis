import { tool } from '@/server/decorator/core';
import { inject } from 'tsyringe';
import { CACHE_PORT } from '@/server/modules/agent/agent.di-tokens';
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

  constructor(@inject(CACHE_PORT) private readonly cacheService: CachePort) {
    super();
  }

  async *call(
    ctx: ToolCallContext,
  ): AsyncGenerator<RunEvent, CachedReadOutput, void> {
    const { key, offset, limit } = ctx.input as unknown as CachedReadInput;

    const result = await this.cacheService.readFile(
      ctx.workDir,
      key,
      offset,
      limit,
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

    // 分页读（带 limit）：尾追续读页脚，把下一块的具体 offset 喂给模型——线性推进而非重读首块。
    // 裸读（无 limit）返全文，不追加（全文已在手）。防 offload↔cached_read 页抖动。
    if (
      typeof result === 'string' &&
      typeof limit === 'number' &&
      limit > 0 &&
      result.length >= limit
    ) {
      const nextOffset = (offset ?? 0) + limit;
      return `${result}\n\n[read offset=${offset ?? 0} limit=${limit}; continue with cached_read(key="${key}", offset=${nextOffset}, limit=${limit})]`;
    }

    return result;
  }
}
