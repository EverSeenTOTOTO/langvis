import { tool } from '@/server/decorator/core';
import { ToolIds } from '@/shared/constants';
import { DocumentChunkEntity } from '@/shared/entities/DocumentChunk';
import { DocumentEntity } from '@/shared/entities/Document';
import type { Logger } from '@/server/utils/logger';
import type { ToolConfig } from '@/shared/types';
import { container, inject } from 'tsyringe';
import { Tool } from '@/server/modules/agent/domain/model/tool.base';
import type { ToolCallContext } from '@/server/modules/agent/domain/port/tool-call-context.port';
import type { RunEvent } from '@/shared/types/events';
import { DatabaseService } from '@/server/libs/infrastructure/database.service';
import type EmbeddingGenerateTool from '../EmbeddingGenerate';
import type ContentChunkTool from '../ContentChunk';
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
    ctx: ToolCallContext,
  ): AsyncGenerator<RunEvent, DocumentStoreOutput, void> {
    const data = ctx.input as unknown as DocumentStoreInput;
    const { document } = data;

    // 分块:复用 content_chunk 工具(与 embedding 同样内部 resolve 调用)。
    // 分块策略/参数是存储层的内部细节,用 content_chunk 的默认值(paragraph/1000),
    // 不暴露给调用方。
    const chunkTool = container.resolve<ContentChunkTool>(
      ToolIds.CONTENT_CHUNK,
    );
    const chunkResult = yield* chunkTool.call({
      ...ctx,
      input: { content: document.rawContent },
    });
    const chunks = chunkResult.chunks;

    // 向量由内部 EmbeddingGenerate 按 chunks 顺序生成（与 DocumentSearch 同模式），
    // 调用方不再搬运 number[][]，模型循环里也不会出现大块向量。
    const embedTool = container.resolve<EmbeddingGenerateTool>(
      ToolIds.EMBEDDING_GENERATE,
    );
    const embedResult = yield* embedTool.call({ ...ctx, input: { chunks } });
    const embeddings = embedResult.embeddings;

    // Coerce keywords: LLM may pass comma-separated string(s).
    // Ajv coerceTypes wraps a bare string as single-element array,
    // so flatMap splits any comma-separated elements.
    const keywords =
      typeof document.keywords === 'string'
        ? document.keywords
            .split(/[,，;；\s]+/)
            .map(s => s.trim())
            .filter(s => s)
        : document.keywords;

    yield {
      type: 'tool_progress',
      callId: ctx.callId,
      data: {
        message: `Saving document "${document.title}" to database...`,
        data: { title: document.title, chunkCount: chunks.length },
      },
    };

    const result = await this.db.dataSource.transaction(async manager => {
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

      const chunkEntities = chunks.map((chunk, i) =>
        manager.create(DocumentChunkEntity, {
          documentId: doc.id,
          chunkIndex: chunk.index,
          content: chunk.content,
          embedding: embeddings[i],
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
      type: 'tool_progress',
      callId: ctx.callId,
      data: {
        message: `Document saved with ${result.chunkCount} chunks`,
        data: { documentId: result.documentId },
      },
    };

    const output: DocumentStoreOutput = result;

    return output;
  }
}

export { config };
