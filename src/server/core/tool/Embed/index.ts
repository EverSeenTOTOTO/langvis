import { tool } from '@/server/decorator/core';
import { input } from '@/server/decorator/param';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import type { ToolConfig, ToolEvent } from '@/shared/types';
import { Tool } from '..';
import { ExecutionContext } from '../../ExecutionContext';
import type { EmbedInput, EmbedOutput } from './config';
import { config } from './config';

const DEFAULT_MODEL = 'text-embedding-3-small';

@tool(ToolIds.EMBED)
export default class EmbedTool extends Tool<EmbedInput, EmbedOutput> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  async *call(
    @input() data: EmbedInput,
    ctx: ExecutionContext,
  ): AsyncGenerator<ToolEvent, EmbedOutput, void> {
    const { chunks, model = DEFAULT_MODEL } = data;

    const apiBase = process.env.OPENAI_API_BASE;
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiBase || !apiKey) {
      throw new Error('OPENAI_API_BASE and OPENAI_API_KEY must be configured');
    }

    const url = `${apiBase}/v1/embeddings`;
    const texts = chunks.map(c => c.content);

    this.logger.info(
      `Generating embeddings for ${chunks.length} chunks using ${model}`,
    );

    yield ctx.toolProgressEvent(this.id, {
      message: `Calling embedding API (${model}) for ${chunks.length} texts...`,
      data: { model, textCount: chunks.length },
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, input: texts }),
      signal: ctx.signal,
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

    yield ctx.toolResultEvent(this.id, output);
    return output;
  }
}

export { config };
