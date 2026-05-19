import { tool } from '@/server/decorator/core';
import { input } from '@/server/decorator/param';
import { LlmService } from '@/server/service/LlmService';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import type { AgentEvent, ToolConfig } from '@/shared/types';
import { inject } from 'tsyringe';
import { Tool } from '..';
import { ExecutionContext } from '../../ExecutionContext';
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
    ctx: ExecutionContext,
  ): AsyncGenerator<AgentEvent, EmbeddingGenerateOutput, void> {
    const { chunks, model, timeout = DEFAULT_TIMEOUT_MS } = data;

    const texts = chunks.map(c => c.content);

    this.logger.info(
      `Generating embeddings for ${chunks.length} chunks using ${model}`,
    );

    yield ctx.agentToolProgressEvent(this.id, {
      message: `Calling embedding API (${model}) for ${chunks.length} texts...`,
      data: { model, textCount: chunks.length },
    });

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
