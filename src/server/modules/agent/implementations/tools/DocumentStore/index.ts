import { tool } from '@/server/decorator/core';
import { ToolIds } from '@/shared/constants';
import { DocumentChunkEntity } from '@/shared/entities/DocumentChunk';
import { DocumentEntity } from '@/shared/entities/Document';
import type { Logger } from '@/server/utils/logger';
import type { ToolConfig } from '@/shared/types';
import { inject } from 'tsyringe';
import { Tool } from '@/server/modules/agent/domain/tool.base';
import type { ToolCall } from '@/server/modules/agent/domain/tool-call.entity';
import { DatabaseService } from '@/server/libs/infrastructure/database.service';
import type { DocumentStoreInput, DocumentStoreOutput } from './config';
import { config } from './config';

@tool(ToolIds.DOCUMENT_STORE)
export default class DocumentStoreTool extends Tool<DocumentStoreOutput> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  constructor(@inject(DatabaseService) private readonly db: DatabaseService) {
    super();
  }

  async *call(
    toolCall: ToolCall,
  ): AsyncGenerator<
    { type: 'tool_progress'; data: unknown },
    DocumentStoreOutput,
    void
  > {
    const data = toolCall.input as unknown as DocumentStoreInput;
    const { document, chunks } = data;

    // Coerce keywords: LLM may pass comma-separated string(s).
    // Ajv coerceTypes wraps a bare string as single-element array,
    // so flatMap splits any comma-separated elements.
    const keywords = (document.keywords as string[]).flatMap(k =>
      k
        .split(/[,，;；\s]+/)
        .map(s => s.trim())
        .filter(s => s),
    );

    yield {
      type: 'tool_progress' as const,
      data: {
        message: `Saving document "${document.title}" to database...`,
        data: { title: document.title, chunkCount: chunks.length },
      },
    };

    const result = await this.db.dataSource.transaction(async manager => {
      // Create document
      const doc = manager.create(DocumentEntity, {
        title: document.title,
        summary: document.summary,
        keywords: keywords,
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

    yield {
      type: 'tool_progress' as const,
      data: {
        message: `Document saved with ${result.chunkCount} chunks`,
        data: { documentId: result.documentId },
      },
    };

    const output: DocumentStoreOutput = result;

    return output;
  }

  override summarizeArgs(args: Record<string, unknown>): string {
    const doc = args.document as DocumentStoreInput['document'] | undefined;
    if (!doc) return '';
    return `("${doc.title}")`;
  }

  override summarizeOutput(output: unknown): string {
    const result = output as DocumentStoreOutput | undefined;
    if (!result) return '完成';
    return `存储 ${result.chunkCount} 个分片`;
  }
}

export { config };
