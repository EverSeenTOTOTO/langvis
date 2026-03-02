import { tool } from '@/server/decorator/core';
import { input } from '@/server/decorator/param';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import type { ToolConfig, ToolEvent } from '@/shared/types';
import { container } from 'tsyringe';
import { Tool } from '..';
import { ExecutionContext } from '../../ExecutionContext';
import type ArchiveTool from '../Archive';
import type ChunkTool from '../Chunk';
import type EmbedTool from '../Embed';
import type MetaExtractTool from '../MetaExtract';
import type { AnalysisInput, AnalysisOutput } from './config';
import { config } from './config';

@tool(ToolIds.ANALYSIS)
export default class AnalysisTool extends Tool<AnalysisInput, AnalysisOutput> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  async *call(
    @input() data: AnalysisInput,
    ctx: ExecutionContext,
  ): AsyncGenerator<ToolEvent, AnalysisOutput, void> {
    const { content, sourceUrl, sourceType, metadata } = data;

    // 1. Extract metadata
    const metaExtractTool = container.resolve<MetaExtractTool>(
      ToolIds.META_EXTRACT,
    );
    const metaResult = yield* metaExtractTool.call(
      { content, sourceUrl, sourceType },
      ctx,
    );

    this.logger.info('Metadata extracted:', metaResult);

    // 2. Chunk content
    const chunkTool = container.resolve<ChunkTool>(ToolIds.CHUNK);
    const chunkResult = yield* chunkTool.call(
      { content, strategy: 'paragraph', options: { maxChunkSize: 1000 } },
      ctx,
    );

    this.logger.info(
      `Content chunked into ${chunkResult.chunks.length} pieces`,
    );

    // 3. Generate embeddings
    const embedTool = container.resolve<EmbedTool>(ToolIds.EMBED);
    const embedResult = yield* embedTool.call(
      { chunks: chunkResult.chunks },
      ctx,
    );

    this.logger.info(
      `Embeddings generated for ${embedResult.chunks.length} chunks`,
    );

    // 4. Archive to database
    const archiveTool = container.resolve<ArchiveTool>(ToolIds.ARCHIVE);
    const archiveResult = yield* archiveTool.call(
      {
        document: {
          title: metaResult.title,
          summary: metaResult.summary,
          keywords: metaResult.keywords,
          category: metaResult.category as any,
          metadata: { ...metaResult.metadata, ...metadata },
          sourceUrl,
          sourceType,
          rawContent: content,
        },
        chunks: embedResult.chunks,
      },
      ctx,
    );

    const output: AnalysisOutput = {
      documentId: archiveResult.documentId,
      title: metaResult.title,
      category: metaResult.category,
      chunkCount: archiveResult.chunkCount,
    };

    yield ctx.toolResultEvent(this.id, output);
    return output;
  }
}

export { config };
