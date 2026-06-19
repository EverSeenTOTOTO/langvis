import { tool } from '@/server/decorator/core';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import type { ToolConfig } from '@/shared/types';
import { Tool } from '@/server/modules/agent/domain/model/tool.base';
import type { ToolCall } from '@/server/modules/agent/domain/model/tool-call.entity';
import type { EnrichedEvent } from '@/shared/types/events';
import type {
  ContentChunkInput,
  ContentChunkOutput,
  ContentChunkItem,
  ContentChunkOptions,
} from './config';
import { config } from './config';

interface ContentChunkStrategyHandler {
  chunk(content: string, options: ContentChunkOptions): ContentChunkItem[];
}

class ParagraphStrategy implements ContentChunkStrategyHandler {
  chunk(content: string, options: ContentChunkOptions): ContentChunkItem[] {
    const maxChunkSize = options.maxChunkSize || 1000;
    const minChunkSize = options.minChunkSize ?? 200;

    const paragraphs = this.splitParagraphs(content);
    const chunks: ContentChunkItem[] = [];
    let currentContentChunk = '';
    let chunkIndex = 0;

    for (const paragraph of paragraphs) {
      const trimmed = paragraph.trim();

      if (currentContentChunk.length + trimmed.length + 1 <= maxChunkSize) {
        currentContentChunk += (currentContentChunk ? '\n\n' : '') + trimmed;
      } else {
        if (currentContentChunk) {
          chunks.push({ content: currentContentChunk, index: chunkIndex++ });
        }

        if (trimmed.length > maxChunkSize) {
          const subContentChunks = this.splitLongText(trimmed, maxChunkSize);
          for (const sub of subContentChunks) {
            chunks.push({ content: sub, index: chunkIndex++ });
          }
          currentContentChunk = '';
        } else {
          currentContentChunk = trimmed;
        }
      }
    }

    if (currentContentChunk) {
      chunks.push({ content: currentContentChunk, index: chunkIndex });
    }

    return this.mergeSmallContentChunks(chunks, minChunkSize, maxChunkSize);
  }

  private splitParagraphs(content: string): string[] {
    const doubleNewline = content.split(/\n\s*\n/).filter(p => p.trim());

    if (doubleNewline.length > 1) return doubleNewline;

    const singleNewline = content.split(/\n/).filter(p => p.trim());
    if (singleNewline.length > 1) return singleNewline;

    return [content];
  }

  private mergeSmallContentChunks(
    chunks: ContentChunkItem[],
    minChunkSize: number,
    maxChunkSize: number,
  ): ContentChunkItem[] {
    if (chunks.length <= 1) return chunks;

    const result: ContentChunkItem[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (
        chunk.content.length < minChunkSize &&
        result.length > 0 &&
        result[result.length - 1].content.length + chunk.content.length + 2 <=
          maxChunkSize
      ) {
        result[result.length - 1].content += '\n\n' + chunk.content;
      } else {
        result.push({ ...chunk, index: result.length });
      }
    }

    return result;
  }

  private splitLongText(text: string, maxSize: number): string[] {
    const delimiters = ['\n', '。', '！', '？', '；', '.', '?', '!', ';'];
    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > maxSize) {
      let splitPos = -1;

      for (const delim of delimiters) {
        const pos = remaining.lastIndexOf(delim, maxSize);
        if (pos !== -1 && pos >= maxSize * 0.3) {
          splitPos = pos + 1;
          break;
        }
      }

      if (splitPos === -1) {
        const spacePos = remaining.lastIndexOf(' ', maxSize);
        if (spacePos !== -1 && spacePos >= maxSize * 0.3) {
          splitPos = spacePos + 1;
        } else {
          splitPos = maxSize;
        }
      }

      chunks.push(remaining.slice(0, splitPos).trim());
      remaining = remaining.slice(splitPos).trim();
    }

    if (remaining) {
      chunks.push(remaining);
    }

    return chunks;
  }
}

class FixedStrategy implements ContentChunkStrategyHandler {
  chunk(content: string, options: ContentChunkOptions): ContentChunkItem[] {
    const maxChunkSize = options.maxChunkSize || 1000;
    const overlap = options.overlap || 0;
    const chunks: ContentChunkItem[] = [];
    let index = 0;
    let start = 0;

    while (start < content.length) {
      const end = Math.min(start + maxChunkSize, content.length);
      const chunkContent = content.slice(start, end);

      chunks.push({
        content: chunkContent,
        index: index++,
        metadata: { start, end },
      });

      start = end - overlap;
      if (start >= content.length - overlap) break;
    }

    return chunks;
  }
}

@tool(ToolIds.CONTENT_CHUNK)
export default class ContentChunkTool extends Tool<ContentChunkOutput> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  private strategies: Map<string, ContentChunkStrategyHandler> = new Map([
    ['paragraph', new ParagraphStrategy()],
    ['fixed', new FixedStrategy()],
  ]);

  async *call(
    toolCall: ToolCall,
  ): AsyncGenerator<EnrichedEvent, ContentChunkOutput, void> {
    const data = toolCall.input as unknown as ContentChunkInput;
    const { content, strategy = 'paragraph', options = {} } = data;

    const handler = this.strategies.get(strategy);
    if (!handler) {
      throw new Error(
        `Unknown chunk strategy "${strategy}". ` +
          `Valid strategies: "paragraph" (splits at sentence/paragraph boundaries, best for natural text), ` +
          `"fixed" (splits at fixed character count, best for structured data). ` +
          `Default is "paragraph".`,
      );
    }

    const chunks = handler.chunk(content, options);

    this.logger.info(
      `ContentChunked content into ${chunks.length} chunks using ${strategy} strategy`,
    );

    yield toolCall.emitProgress({
      message: `Split into ${chunks.length} chunks using "${strategy}" strategy`,
      strategy,
      chunkCount: chunks.length,
      avgChunkSize: Math.round(
        chunks.reduce((sum, c) => sum + c.content.length, 0) / chunks.length,
      ),
    });

    const output: ContentChunkOutput = { chunks };

    return output;
  }
}

export { config };
