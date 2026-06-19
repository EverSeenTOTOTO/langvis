import { tool } from '@/server/decorator/core';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import type { ToolConfig } from '@/shared/types';
import { Tool } from '@/server/modules/agent/domain/model/tool.base';
import type { ToolCallContext } from '@/server/modules/agent/domain/port/tool-call-context.port';
import type { RunEvent } from '@/shared/types/events';
import type { EmbeddingGenerateInput, EmbeddingGenerateOutput } from './config';
import { config } from './config';

const DEFAULT_TIMEOUT_MS = 60_000;

@tool(ToolIds.EMBEDDING_GENERATE)
export default class EmbeddingGenerateTool extends Tool<EmbeddingGenerateOutput> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  async *call(
    ctx: ToolCallContext,
  ): AsyncGenerator<RunEvent, EmbeddingGenerateOutput, void> {
    const data = ctx.input as unknown as EmbeddingGenerateInput;
    const { chunks, model, timeout = DEFAULT_TIMEOUT_MS } = data;

    const texts = chunks.map(c => c.content);

    this.logger.info(
      `Generating embeddings for ${chunks.length} chunks using ${model}`,
    );

    yield {
      type: 'tool_progress',
      callId: ctx.callId,
      data: {
        message: `Calling embedding API (${model}) for ${chunks.length} texts...`,
        model,
        textCount: chunks.length,
      },
    };

    const signal = AbortSignal.timeout(timeout);

    const sortedData = await ctx.llm.embed(model, texts, signal);

    const output: EmbeddingGenerateOutput = {
      chunks: chunks.map((chunk, i) => ({
        ...chunk,
        embedding: sortedData[i].embedding,
      })),
      model,
      dimension: sortedData[0].embedding.length,
    };

    return output;
  }
}

export { config };
