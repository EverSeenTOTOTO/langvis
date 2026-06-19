import { tool } from '@/server/decorator/core';
import { ToolIds } from '@/shared/constants';
import type { Logger } from '@/server/utils/logger';
import type { ToolConfig } from '@/shared/types';
import { container, inject } from 'tsyringe';
import { Tool } from '@/server/modules/agent/domain/model/tool.base';
import type { ToolCall } from '@/server/modules/agent/domain/model/tool-call.entity';
import type { RunEvent } from '@/shared/types/events';
import { DatabaseService } from '@/server/libs/infrastructure/database.service';
import type EmbeddingGenerateTool from '../EmbeddingGenerate';
import type { DocumentSearchInput, DocumentSearchOutput } from './config';
import { config } from './config';

@tool(ToolIds.DOCUMENT_SEARCH)
export default class DocumentSearchTool extends Tool<DocumentSearchOutput> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  constructor(@inject(DatabaseService) private readonly db: DatabaseService) {
    super();
  }

  async *call(
    toolCall: ToolCall,
  ): AsyncGenerator<RunEvent, DocumentSearchOutput, void> {
    const data = toolCall.input as unknown as DocumentSearchInput;
    const { query, limit = 10, threshold } = data;

    // 1. Generate embedding for query
    yield toolCall.emitProgress({
      message: `Generating embedding for query: "${query.slice(0, 50)}${query.length > 50 ? '...' : ''}"`,
      data: { queryLength: query.length },
    });

    const embedTool = container.resolve<EmbeddingGenerateTool>(
      ToolIds.EMBEDDING_GENERATE,
    );
    const originalInput = toolCall.input;
    toolCall.input = { chunks: [{ content: query, index: 0 }] };
    const embedResult = yield* embedTool.call(toolCall);
    toolCall.input = originalInput;

    const queryVector = embedResult.chunks[0].embedding;

    // 2. Vector similarity search using pgvector
    const vectorStr = `[${queryVector.join(',')}]`;

    yield toolCall.emitProgress({
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

    const rows = await this.db.dataSource.query(rawQuery, [vectorStr, limit]);

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

    yield toolCall.emitProgress({
      message: `Found ${results.length} relevant chunks from ${new Set(results.map((r: (typeof results)[0]) => r.document.id)).size} documents`,
      data: {
        resultCount: results.length,
        topSimilarity: results[0]?.similarity?.toFixed(3),
      },
    });

    return { results };
  }

  override summarizeArgs(args: Record<string, unknown>): string {
    const query = typeof args.query === 'string' ? args.query : '';
    const preview = query.length > 30 ? `${query.slice(0, 30)}...` : query;
    return `(${preview})`;
  }

  override summarizeOutput(output: unknown): string {
    const result = output as DocumentSearchOutput | undefined;
    if (!result) return '完成';
    return `检索到 ${result.results.length} 条`;
  }
}

export { config };
