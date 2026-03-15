import { tool } from '@/server/decorator/core';
import { input } from '@/server/decorator/param';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import type { AgentEvent, ToolConfig } from '@/shared/types';
import { createTimeoutController } from '@/server/utils/abort';
import { Tool } from '..';
import { ExecutionContext } from '../../ExecutionContext';
import type { EmbedInput, EmbedOutput } from './config';
import { config } from './config';

const DEFAULT_TIMEOUT_MS = 60_000; // 1 minute

@tool(ToolIds.EMBEDDING_GENERATE)
export default class EmbedTool extends Tool<EmbedInput, EmbedOutput> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  async *call(
    @input() data: EmbedInput,
    ctx: ExecutionContext,
  ): AsyncGenerator<AgentEvent, EmbedOutput, void> {
    const {
      chunks,
      model = process.env.OPENAI_EMBEDDING_MODEL!,
      timeout = DEFAULT_TIMEOUT_MS,
    } = data;

    const apiBase = process.env.OPENAI_API_BASE;
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiBase || !apiKey) {
      throw new Error('OPENAI_API_BASE and OPENAI_API_KEY must be configured');
    }

    const url = `${apiBase}/embeddings`;
    const texts = chunks.map(c => c.content);

    this.logger.info(
      `Generating embeddings for ${chunks.length} chunks using ${model}`,
    );

    yield ctx.agentToolProgressEvent(this.id, {
      message: `Calling embedding API (${model}) for ${chunks.length} texts...`,
      data: { model, textCount: chunks.length },
    });

    const [controller, cleanup] = createTimeoutController(timeout, ctx.signal);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model, input: texts }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Embedding API failed: ${response.status} - ${text}`);
      }

      const result = (await response.json()) as {
        data: Array<{ embedding: number[]; index: number }>;
      };

      // Sort by index to ensure correct order
      const sortedData = result.data.sort((a, b) => a.index - b.index);

      const output: EmbedOutput = {
        chunks: chunks.map((chunk, i) => ({
          ...chunk,
          embedding: sortedData[i].embedding,
        })),
        model,
        dimension: sortedData[0].embedding.length,
      };

      return output;
    } finally {
      cleanup();
    }
  }
}

export { config };
