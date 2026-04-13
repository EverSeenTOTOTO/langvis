import { tool } from '@/server/decorator/core';
import { input } from '@/server/decorator/param';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import { AgentEvent, ToolConfig } from '@/shared/types';
import { createTimeoutController } from '@/server/utils/abort';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';
import { Tool } from '..';
import { ExecutionContext } from '../../ExecutionContext';
import { sanitizeHtml } from '@/server/utils/sanitizeHtml';
import type { WebFetchInput, WebFetchOutput } from './config';

const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

@tool(ToolIds.WEB_FETCH)
export default class WebFetchTool extends Tool<WebFetchInput, WebFetchOutput> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  private async doFetch(
    url: string,
    signal: AbortSignal,
    proxy?: string,
  ): Promise<Response> {
    this.logger.info(
      `Fetching content from: ${url}${proxy ? ' (with proxy)' : ''}`,
    );

    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      },
      signal,
      // @ts-expect-error bun fetch option
      proxy,
    });

    if (!response.ok) {
      const statusHints: Record<number, string> = {
        403: 'Access denied - the site may require authentication or block bots',
        404: 'Page not found - verify the URL is correct',
        429: 'Rate limited - wait before retrying or use a proxy',
        500: 'Server error - the target site may be temporarily unavailable',
        502: 'Bad gateway - the target site may be experiencing issues',
        503: 'Service unavailable - the target site may be down',
      };
      const hint =
        statusHints[response.status] ||
        'Check URL validity and network connectivity';
      throw new Error(
        `Failed to fetch URL (${response.status} ${response.statusText}). ${hint}. URL: ${url}`,
      );
    }

    return response;
  }

  async *call(
    @input() data: WebFetchInput,
    ctx: ExecutionContext,
  ): AsyncGenerator<AgentEvent, WebFetchOutput, void> {
    ctx.signal.throwIfAborted();

    const {
      url,
      timeout = 30000,
      retry = 0,
      response_format = 'concise',
    } = data;
    const proxy = process.env.WEB_FETCH_PROXY;

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= retry; attempt++) {
      ctx.signal.throwIfAborted();

      const [controller, cleanup] = createTimeoutController(
        timeout,
        ctx.signal,
      );

      try {
        const response = await this.doFetch(url, controller.signal, proxy);

        const html = await response.text();

        const sanitizedHTML = sanitizeHtml(html);

        const sanitizedDOM = new JSDOM(sanitizedHTML, { url });
        const reader = new Readability(sanitizedDOM.window.document);
        const article = reader.parse();

        if (!article) {
          throw new Error(
            `Failed to extract article content from URL. ` +
              `Possible causes: (1) page requires JavaScript rendering, ` +
              `(2) content is behind a paywall or login, ` +
              `(3) page has non-standard HTML structure. ` +
              `Try: fetch a different URL, or provide content directly. URL: ${url}`,
          );
        }

        this.logger.info(`Successfully extracted content from: ${url}`);

        const markdownContent = article.content
          ? turndownService.turndown(article.content)
          : '';

        if (response_format === 'concise') {
          return {
            title: article.title || '',
            content: markdownContent,
          };
        }

        return {
          title: article.title || '',
          content: markdownContent,
          excerpt: article.excerpt || '',
          author: article.byline || null,
          siteName: article.siteName || null,
          url,
        };
      } catch (error) {
        lastError = error as Error;

        if (attempt < retry) {
          this.logger.warn(
            `Fetch attempt ${attempt + 1} failed, retrying: ${(error as Error)?.message ?? String(error)}`,
          );
        }
      } finally {
        cleanup();
      }
    }

    throw lastError;
  }

  override summarizeArgs(args: Record<string, unknown>): string {
    const url = typeof args.url === 'string' ? args.url : '';
    return `(${url})`;
  }

  override summarizeOutput(output: unknown): string {
    const result = output as WebFetchOutput | undefined;
    if (!result) return '完成';
    const length = result.content?.length ?? 0;
    return `获取 ${length} 字符`;
  }
}
