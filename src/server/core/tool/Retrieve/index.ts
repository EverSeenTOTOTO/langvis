import { tool } from '@/server/decorator/core';
import { input } from '@/server/decorator/param';
import { InjectTokens, ToolIds } from '@/shared/constants';
import type { Logger } from '@/server/utils/logger';
import type { ToolConfig, ToolEvent } from '@/shared/types';
import { DataSource } from 'typeorm';
import { container, inject } from 'tsyringe';
import { Tool } from '..';
import { ExecutionContext } from '../../ExecutionContext';
import type EmbedTool from '../Embed';
import type { RetrieveInput, RetrieveOutput } from './config';
import { config } from './config';

@tool(ToolIds.RETRIEVE)
export default class RetrieveTool extends Tool<RetrieveInput, RetrieveOutput> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  constructor(
    @inject(InjectTokens.PG) private readonly dataSource: DataSource,
  ) {
    super();
  }

  async *call(
    @input() data: RetrieveInput,
    ctx: ExecutionContext,
  ): AsyncGenerator<ToolEvent, RetrieveOutput, void> {
    const { query, limit = 10, threshold } = data;

    // 1. Generate embedding for query
    yield ctx.toolProgressEvent(this.id, {
      message: `Generating embedding for query: "${query.slice(0, 50)}${query.length > 50 ? '...' : ''}"`,
      data: { queryLength: query.length },
    });

    const embedTool = container.resolve<EmbedTool>(ToolIds.EMBED);
    const embedResult = yield* embedTool.call(
      { chunks: [{ content: query, index: 0 }] },
      ctx,
    );

    const queryVector = embedResult.chunks[0].embedding;

    // 2. Vector similarity search using pgvector
    const vectorStr = `[${queryVector.join(',')}]`;

    yield ctx.toolProgressEvent(this.id, {
      message: `Searching vector database for top ${limit} similar chunks...`,
      data: { limit, threshold },
    });

    const rawQuery = `
      SELECT
        dc.id as "chunkId",
        dc.content,
        dc.embedding <=> $1::vector as distance,
        d.id as "documentId",
        d.title,
        d.category,
        d."sourceUrl"
      FROM document_chunks dc
      JOIN documents d ON dc."documentId" = d.id
      ORDER BY dc.embedding <=> $1::vector
      LIMIT $2
    `;

    const rows = await this.dataSource.query(rawQuery, [vectorStr, limit]);

    // 3. Calculate similarity and filter by threshold
    const results = rows
      .map((row: any) => ({
        chunkId: row.chunkId,
        content: row.content,
        similarity: 1 - parseFloat(row.distance),
        document: {
          id: row.documentId,
          title: row.title,
          category: row.category,
          sourceUrl: row.sourceUrl,
        },
      }))
      .filter((r: any) => (threshold ? r.similarity >= threshold : true));

    this.logger.info(
      `Found ${results.length} results for query: "${query.slice(0, 50)}..."`,
    );

    yield ctx.toolProgressEvent(this.id, {
      message: `Found ${results.length} relevant chunks from ${new Set(results.map((r: (typeof results)[0]) => r.document.id)).size} documents`,
      data: {
        resultCount: results.length,
        topSimilarity: results[0]?.similarity?.toFixed(3),
      },
    });

    const output: RetrieveOutput = { results };

    yield ctx.toolResultEvent(this.id, output);
    return output;
  }
}

export { config };
