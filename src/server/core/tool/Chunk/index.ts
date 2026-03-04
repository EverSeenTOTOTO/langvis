import { tool } from '@/server/decorator/core';
import { input } from '@/server/decorator/param';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import type { ToolConfig, AgentEvent } from '@/shared/types';
import { Tool } from '..';
import { ExecutionContext } from '../../ExecutionContext';
import type {
  ChunkInput,
  ChunkOutput,
  ChunkItem,
  ChunkOptions,
} from './config';
import { config } from './config';

interface ChunkStrategyHandler {
  chunk(content: string, options: ChunkOptions): ChunkItem[];
}

class ParagraphStrategy implements ChunkStrategyHandler {
  chunk(content: string, options: ChunkOptions): ChunkItem[] {
    const maxChunkSize = options.maxChunkSize || 1000;
    const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim());
    const chunks: ChunkItem[] = [];

    let currentChunk = '';
    let chunkIndex = 0;

    for (const paragraph of paragraphs) {
      const trimmed = paragraph.trim();

      if (currentChunk.length + trimmed.length + 1 <= maxChunkSize) {
        currentChunk += (currentChunk ? '\n\n' : '') + trimmed;
      } else {
        if (currentChunk) {
          chunks.push({ content: currentChunk, index: chunkIndex++ });
        }

        // If single paragraph exceeds max, split it
        if (trimmed.length > maxChunkSize) {
          const subChunks = this.splitLongText(trimmed, maxChunkSize);
          for (const sub of subChunks) {
            chunks.push({ content: sub, index: chunkIndex++ });
          }
          currentChunk = '';
        } else {
          currentChunk = trimmed;
        }
      }
    }

    if (currentChunk) {
      chunks.push({ content: currentChunk, index: chunkIndex });
    }

    return chunks;
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

class FixedStrategy implements ChunkStrategyHandler {
  chunk(content: string, options: ChunkOptions): ChunkItem[] {
    const maxChunkSize = options.maxChunkSize || 1000;
    const overlap = options.overlap || 0;
    const chunks: ChunkItem[] = [];
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

@tool(ToolIds.CHUNK)
export default class ChunkTool extends Tool<ChunkInput, ChunkOutput> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  private strategies: Map<string, ChunkStrategyHandler> = new Map([
    ['paragraph', new ParagraphStrategy()],
    ['fixed', new FixedStrategy()],
  ]);

  async *call(
    @input() data: ChunkInput,
    ctx: ExecutionContext,
  ): AsyncGenerator<AgentEvent, ChunkOutput, void> {
    const { content, strategy = 'paragraph', options = {} } = data;

    const handler = this.strategies.get(strategy);
    if (!handler) {
      throw new Error(`Unknown chunk strategy: ${strategy}`);
    }

    const chunks = handler.chunk(content, options);

    this.logger.info(
      `Chunked content into ${chunks.length} chunks using ${strategy} strategy`,
    );

    yield ctx.agentToolProgressEvent(this.id, {
      message: `Split into ${chunks.length} chunks using "${strategy}" strategy`,
      data: {
        strategy,
        chunkCount: chunks.length,
        avgChunkSize: Math.round(
          chunks.reduce((sum, c) => sum + c.content.length, 0) / chunks.length,
        ),
      },
    });

    const output: ChunkOutput = { chunks };

    return output;
    return output;
  }
}

export { config };
