import { tool } from '@/server/decorator/core';
import { input } from '@/server/decorator/param';
import { LlmService } from '@/server/modules/memory/services/llm.service';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import type { ToolConfig } from '@/shared/types';
import { inject } from 'tsyringe';
import { Tool } from '@/server/modules/agent/domain/tool.base';
import type { EmbeddingGenerateInput, EmbeddingGenerateOutput } from './config';
import { config } from './config';

const DEFAULT_TIMEOUT_MS = 60_000;

@tool(ToolIds.EMBEDDING_GENERATE)
export default class EmbeddingGenerateTool extends Tool<
  EmbeddingGenerateInput,
  EmbeddingGenerateOutput
> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  constructor(@inject(LlmService) private readonly llmService: LlmService) {
    super();
  }

  async *call(
    @input() data: EmbeddingGenerateInput,
    _ctx: { signal: AbortSignal },
  ): AsyncGenerator<
    { type: 'tool_progress'; data: unknown },
    EmbeddingGenerateOutput,
    void
  > {
    const { chunks, model, timeout = DEFAULT_TIMEOUT_MS } = data;

    const texts = chunks.map(c => c.content);

    this.logger.info(
      `Generating embeddings for ${chunks.length} chunks using ${model}`,
    );

    yield {
      type: 'tool_progress' as const,
      data: {
        message: `Calling embedding API (${model}) for ${chunks.length} texts...`,
        model,
        textCount: chunks.length,
      },
    };

    const signal = AbortSignal.timeout(timeout);

    const sortedData = await this.llmService.embed(model, texts, signal);

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

  override summarizeArgs(args: Record<string, unknown>): string {
    const chunks = args.chunks as EmbeddingGenerateInput['chunks'] | undefined;
    if (!chunks) return '';
    return `(${chunks.length} 条文本)`;
  }

  override summarizeOutput(output: unknown): string {
    const result = output as EmbeddingGenerateOutput | undefined;
    if (!result) return '完成';
    return `生成 ${result.chunks.length} 个向量 (dim=${result.dimension})`;
  }
}

export { config };
