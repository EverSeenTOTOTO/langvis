import { tool } from '@/server/decorator/core';
import { input } from '@/server/decorator/param';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import type { AgentEvent, ToolConfig } from '@/shared/types';
import { createTimeoutController } from '@/server/utils/abort';
import { container } from 'tsyringe';
import { Tool } from '..';
import { ExecutionContext } from '../../ExecutionContext';
import type ArchiveTool from '../Archive';
import type ChunkTool from '../Chunk';
import type EmbedTool from '../Embed';
import type MetaExtractTool from '../MetaExtract';
import type { AnalysisInput, AnalysisOutput } from './config';
import { config } from './config';

const DEFAULT_TIMEOUT_MS = 120_000; // 2 minutes

@tool(ToolIds.DOCUMENT_ARCHIVE)
export default class AnalysisTool extends Tool<AnalysisInput, AnalysisOutput> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  async *call(
    @input() data: AnalysisInput,
    ctx: ExecutionContext,
  ): AsyncGenerator<AgentEvent, AnalysisOutput, void> {
    const {
      content,
      sourceUrl,
      sourceType,
      metadata,
      timeout = DEFAULT_TIMEOUT_MS,
    } = data;

    // Setup timeout controller
    const [timeoutController, cleanup] = createTimeoutController(
      timeout,
      ctx.signal,
    );

    try {
      // 1. Extract metadata
      yield ctx.agentToolProgressEvent(this.id, {
        action: 'meta_extract',
        message: 'Extracting document metadata via LLM...',
      });

      timeoutController.signal.throwIfAborted();

      const metaExtractTool = container.resolve<MetaExtractTool>(
        ToolIds.DOCUMENT_METADATA_EXTRACT,
      );
      const metaResult = yield* metaExtractTool.call(
        { content, sourceUrl, sourceType },
        ctx,
      );

      this.logger.info('Metadata extracted:', metaResult);

      // 2. Chunk content
      yield ctx.agentToolProgressEvent(this.id, {
        action: 'chunk',
        message: `Chunking content (${Math.round(content.length / 1024)}KB) into segments...`,
      });

      timeoutController.signal.throwIfAborted();

      const chunkTool = container.resolve<ChunkTool>(ToolIds.CONTENT_CHUNK);
      const chunkResult = yield* chunkTool.call(
        { content, strategy: 'paragraph', options: { maxChunkSize: 1000 } },
        ctx,
      );

      this.logger.info(
        `Content chunked into ${chunkResult.chunks.length} pieces`,
      );

      // 3. Generate embeddings
      yield ctx.agentToolProgressEvent(this.id, {
        action: 'embed',
        message: `Calling embedding API for ${chunkResult.chunks.length} chunks...`,
      });

      timeoutController.signal.throwIfAborted();

      const embedTool = container.resolve<EmbedTool>(
        ToolIds.EMBEDDING_GENERATE,
      );
      const embedResult = yield* embedTool.call(
        { chunks: chunkResult.chunks, timeout },
        ctx,
      );

      this.logger.info(
        `Embeddings generated for ${embedResult.chunks.length} chunks`,
      );

      // 4. Archive to database
      yield ctx.agentToolProgressEvent(this.id, {
        action: 'archive',
        message: `Saving document "${metaResult.title}" and ${embedResult.chunks.length} chunks to database...`,
      });

      timeoutController.signal.throwIfAborted();

      const archiveTool = container.resolve<ArchiveTool>(
        ToolIds.DOCUMENT_STORE,
      );
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

      return {
        documentId: archiveResult.documentId,
        title: metaResult.title,
        category: metaResult.category,
        chunkCount: archiveResult.chunkCount,
      };
    } finally {
      cleanup();
    }
  }
}

export { config };
