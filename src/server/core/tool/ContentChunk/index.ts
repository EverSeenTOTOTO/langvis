import { tool } from '@/server/decorator/core';
import { input } from '@/server/decorator/param';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import type { ToolConfig, AgentEvent } from '@/shared/types';
import { Tool } from '..';
import { ExecutionContext } from '../../ExecutionContext';
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
    const maxContentChunkSize = options.maxContentChunkSize || 1000;
    const minContentChunkSize = options.minContentChunkSize ?? 200;
    const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim());
    const chunks: ContentChunkItem[] = [];

    let currentContentChunk = '';
    let chunkIndex = 0;

    for (const paragraph of paragraphs) {
      const trimmed = paragraph.trim();

      if (
        currentContentChunk.length + trimmed.length + 1 <=
        maxContentChunkSize
      ) {
        currentContentChunk += (currentContentChunk ? '\n\n' : '') + trimmed;
      } else {
        if (currentContentChunk) {
          chunks.push({ content: currentContentChunk, index: chunkIndex++ });
        }

        // If single paragraph exceeds max, split it
        if (trimmed.length > maxContentChunkSize) {
          const subContentChunks = this.splitLongText(
            trimmed,
            maxContentChunkSize,
          );
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

    // Merge small final chunks into the previous one
    return this.mergeSmallContentChunks(chunks, minContentChunkSize);
  }

  private mergeSmallContentChunks(
    chunks: ContentChunkItem[],
    minContentChunkSize: number,
  ): ContentChunkItem[] {
    if (chunks.length <= 1) return chunks;

    const result: ContentChunkItem[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (chunk.content.length < minContentChunkSize && result.length > 0) {
        result[result.length - 1].content += '\n\n' + chunk.content;
      } else {
        result.push({ ...chunk, index: result.length });
      }
    }

    return result;
  }

  private splitLongText(text: string, maxSize: number): string[] {
    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > maxSize) {
      // Try to split at sentence boundary
      let splitPos = remaining.lastIndexOf('。', maxSize);
      if (splitPos === -1 || splitPos < maxSize / 2) {
        splitPos = remaining.lastIndexOf('.', maxSize);
      }
      if (splitPos === -1 || splitPos < maxSize / 2) {
        splitPos = remaining.lastIndexOf(' ', maxSize);
      }
      if (splitPos === -1 || splitPos < maxSize / 2) {
        splitPos = maxSize;
      } else {
        splitPos += 1; // Include the delimiter
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
    const maxContentChunkSize = options.maxContentChunkSize || 1000;
    const overlap = options.overlap || 0;
    const chunks: ContentChunkItem[] = [];
    let index = 0;
    let start = 0;

    while (start < content.length) {
      const end = Math.min(start + maxContentChunkSize, content.length);
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
export default class ContentChunkTool extends Tool<
  ContentChunkInput,
  ContentChunkOutput
> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  private strategies: Map<string, ContentChunkStrategyHandler> = new Map([
    ['paragraph', new ParagraphStrategy()],
    ['fixed', new FixedStrategy()],
  ]);

  async *call(
    @input() data: ContentChunkInput,
    ctx: ExecutionContext,
  ): AsyncGenerator<AgentEvent, ContentChunkOutput, void> {
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

    yield ctx.agentToolProgressEvent(this.id, {
      message: `Split into ${chunks.length} chunks using "${strategy}" strategy`,
      data: {
        strategy,
        chunkCount: chunks.length,
        avgContentChunkSize: Math.round(
          chunks.reduce((sum, c) => sum + c.content.length, 0) / chunks.length,
        ),
      },
    });

    const output: ContentChunkOutput = { chunks };

    return output;
  }
}

export { config };
