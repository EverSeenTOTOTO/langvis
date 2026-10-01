import { Inject } from '@nestjs/common';
import { tool } from '@/server/modules/agent/application/tools/register-tool';
import { ToolIds } from '@/shared/constants';
import { DocumentChunkEntity } from '@/shared/entities/DocumentChunk';
import { DocumentEntity } from '@/shared/entities/Document';
import type { Logger } from '@/server/utils/logger';
import type { ToolConfig } from '@/shared/types';
import { Tool } from '@/server/modules/agent/domain/model/tool.base';
import type { ToolCallContext } from '@/server/modules/agent/domain/port/tool-call-context.port';
import type { RunEvent } from '@/shared/types/events';
import { ToolService } from '@/server/modules/agent/application/service/tool.service';
import { DatabaseService } from '@/server/infrastructure/database/database.service';
import { WorkspaceService } from '@/server/infrastructure/workspace/workspace.service';
import type { DocumentStoreInput, DocumentStoreOutput } from './config';
import { config } from './config';

/** content_chunk 工具的返回块形状（内部分块复用）。 */
interface ChunkOutput {
  content: string;
  index: number;
  metadata?: Record<string, unknown>;
}

@tool(ToolIds.DOCUMENT_STORE)
export default class DocumentStoreTool extends Tool<DocumentStoreOutput> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(WorkspaceService)
    private readonly workspace: WorkspaceService,
    @Inject(ToolService) private readonly toolService: ToolService,
  ) {
    super();
  }

  async *call(
    ctx: ToolCallContext,
  ): AsyncGenerator<RunEvent, DocumentStoreOutput, void> {
    const data = ctx.input as unknown as DocumentStoreInput;

    // rawFile（盘上 offload 件）优先于 rawContent：DocumentStore 自读全文，
    // 下游 ContentChunk/EmbeddingGenerate 收到的已是解析后的字符串，二者无需感知文件。
    const rawContent = data.document.rawFile
      ? await this.readWorkFile(ctx.workDir, data.document.rawFile)
      : (data.document.rawContent ?? '');
    const document = { ...data.document, rawContent };

    // 分块:复用 content_chunk 工具。分块策略/参数是存储层的内部细节,
    // 用 content_chunk 的默认值(paragraph/1000),不暴露给调用方。
    const chunkTool = this.toolService.resolve(ToolIds.CONTENT_CHUNK)!;
    const chunkOut = yield* chunkTool.call({
      ...ctx,
      input: { content: rawContent },
    });
    const chunks = (chunkOut as { chunks: ChunkOutput[] }).chunks;

    // 向量由内部 EmbeddingGenerate 按 chunks 顺序生成（与 DocumentSearch 同模式），
    // 调用方不再搬运 number[][]，模型循环里也不会出现大块向量。
    const embedTool = this.toolService.resolve(ToolIds.EMBEDDING_GENERATE)!;
    const embedOut = yield* embedTool.call({
      ...ctx,
      input: { chunks: chunks.map(c => c.content) },
    });
    const embeddings = (embedOut as { embeddings: number[][] }).embeddings;

    // Coerce keywords: LLM may pass comma-separated string(s).
    // Ajv wraps a bare string as single-element array, so flatMap splits comma-separated elements.
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

  private async readWorkFile(
    workDir: string,
    filename: string,
  ): Promise<string> {
    const result = await this.workspace.readFile(filename, workDir);
    if (!result) {
      throw new Error(`rawFile not found in workDir: ${filename}`);
    }
    return result.content;
  }
}

export { config };
