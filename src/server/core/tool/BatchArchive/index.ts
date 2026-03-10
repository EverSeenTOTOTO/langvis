import { tool } from '@/server/decorator/core';
import { input } from '@/server/decorator/param';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import type { AgentEvent, ToolConfig } from '@/shared/types';
import { container } from 'tsyringe';
import { Tool } from '..';
import { ExecutionContext } from '../../ExecutionContext';
import type AnalysisTool from '../Analysis';
import type WebFetchTool from '../WebFetch';
import type {
  ArchiveResult,
  BatchArchiveInput,
  BatchArchiveOutput,
} from './config';
import { config } from './config';

const DEFAULT_TIMEOUT_MS = 120_000; // 2 minutes per URL

@tool(ToolIds.BATCH_ARCHIVE)
export default class BatchArchiveTool extends Tool<
  BatchArchiveInput,
  BatchArchiveOutput
> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  async *call(
    @input() data: BatchArchiveInput,
    ctx: ExecutionContext,
  ): AsyncGenerator<AgentEvent, BatchArchiveOutput, void> {
    ctx.signal.throwIfAborted();

    const { urls, timeout = DEFAULT_TIMEOUT_MS } = data;
    const results: ArchiveResult[] = [];

    this.logger.info(`Starting batch archive for ${urls.length} URLs`);

    const webFetchTool = container.resolve<WebFetchTool>(ToolIds.WEB_FETCH);
    const analysisTool = container.resolve<AnalysisTool>(ToolIds.ANALYSIS);

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      const current = i + 1;

      ctx.signal.throwIfAborted();

      // Yield progress event - processing
      yield ctx.agentToolProgressEvent(this.id, {
        current,
        total: urls.length,
        url,
        status: 'processing',
      });

      try {
        // Step 1: Fetch content from URL
        this.logger.info(`[${current}/${urls.length}] Fetching: ${url}`);
        const fetchResult = yield* webFetchTool.call({ url }, ctx);

        // Step 2: Archive the content (with timeout)
        this.logger.info(`[${current}/${urls.length}] Archiving: ${url}`);
        const archiveResult = yield* analysisTool.call(
          {
            content: fetchResult.textContent,
            sourceUrl: url,
            sourceType: 'web',
            timeout,
          },
          ctx,
        );

        results.push({
          url,
          status: 'success',
          documentId: archiveResult.documentId,
          title: archiveResult.title,
        });

        // Yield progress event - success
        yield ctx.agentToolProgressEvent(this.id, {
          current,
          total: urls.length,
          url,
          status: 'success',
          documentId: archiveResult.documentId,
          title: archiveResult.title,
        });
      } catch (error) {
        const errorMsg = (error as Error).message;
        const isTimeout = errorMsg.includes('timed out');
        this.logger.error(
          `[${current}/${urls.length}] ${isTimeout ? 'Timeout' : 'Failed'}: ${url} - ${errorMsg}`,
        );

        results.push({
          url,
          status: 'failed',
          error: errorMsg,
        });

        // Yield progress event - failed
        yield ctx.agentToolProgressEvent(this.id, {
          current,
          total: urls.length,
          url,
          status: 'failed',
          error: errorMsg,
        });
      }
    }

    const succeeded = results.filter(r => r.status === 'success').length;
    const failed = results.filter(r => r.status === 'failed').length;

    this.logger.info(
      `Batch archive completed: ${succeeded} succeeded, ${failed} failed`,
    );

    return {
      total: urls.length,
      succeeded,
      failed,
      results,
    };
  }
}

export { config };
