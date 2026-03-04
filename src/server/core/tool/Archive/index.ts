import { tool } from '@/server/decorator/core';
import { input } from '@/server/decorator/param';
import { InjectTokens, ToolIds } from '@/shared/constants';
import { DocumentChunkEntity } from '@/shared/entities/DocumentChunk';
import { DocumentEntity } from '@/shared/entities/Document';
import type { Logger } from '@/server/utils/logger';
import type { ToolConfig, ToolEvent } from '@/shared/types';
import { DataSource } from 'typeorm';
import { inject } from 'tsyringe';
import { Tool } from '..';
import { ExecutionContext } from '../../ExecutionContext';
import type { ArchiveInput, ArchiveOutput } from './config';
import { config } from './config';

@tool(ToolIds.ARCHIVE)
export default class ArchiveTool extends Tool<ArchiveInput, ArchiveOutput> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  constructor(
    @inject(InjectTokens.PG) private readonly dataSource: DataSource,
  ) {
    super();
  }

  async *call(
    @input() data: ArchiveInput,
    ctx: ExecutionContext,
  ): AsyncGenerator<ToolEvent, ArchiveOutput, void> {
    const { document, chunks } = data;

    yield ctx.toolProgressEvent(this.id, {
      message: `Saving document "${document.title}" to database...`,
      data: { title: document.title, chunkCount: chunks.length },
    });

    const result = await this.dataSource.transaction(async manager => {
      // Create document
      const doc = manager.create(DocumentEntity, {
        title: document.title,
        summary: document.summary,
        keywords: document.keywords,
        category: document.category,
        metadata: document.metadata,
        sourceUrl: document.sourceUrl,
        sourceType: document.sourceType,
        rawContent: document.rawContent,
      });
      await manager.save(doc);

      this.logger.info(`Created document: ${doc.id}`);

      // Create chunks
      const chunkEntities = chunks.map(chunk =>
        manager.create(DocumentChunkEntity, {
          documentId: doc.id,
          chunkIndex: chunk.index,
          content: chunk.content,
          embedding: chunk.embedding,
          metadata: chunk.metadata,
        }),
      );
      await manager.save(chunkEntities);

      this.logger.info(
        `Created ${chunkEntities.length} chunks for document ${doc.id}`,
      );

      return { documentId: doc.id, chunkCount: chunks.length };
    });

    yield ctx.toolProgressEvent(this.id, {
      message: `Document saved with ${result.chunkCount} chunks`,
      data: { documentId: result.documentId },
    });

    const output: ArchiveOutput = result;

    yield ctx.toolResultEvent(this.id, output);
    return output;
  }
}

export { config };
