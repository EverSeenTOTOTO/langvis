import { tool } from '@/server/decorator/core';
import { input } from '@/server/decorator/param';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import { AgentEvent, ToolConfig } from '@/shared/types';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { Tool } from '..';
import { ExecutionContext } from '../../ExecutionContext';
import { sanitizeHtml } from '@/server/utils/sanitizeHtml';

interface WebFetchInput {
  url: string;
  timeout?: number;
  retry?: number;
}

interface WebFetchOutput {
  title: string;
  textContent: string;
  excerpt: string;
  byline: string | null;
  siteName: string | null;
  url: string;
}

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
      throw new Error(
        `Failed to fetch URL: ${response.status} ${response.statusText}`,
      );
    }

    return response;
  }

  async *call(
    @input() data: WebFetchInput,
    ctx: ExecutionContext,
  ): AsyncGenerator<AgentEvent, WebFetchOutput, void> {
    ctx.signal.throwIfAborted();

    const { url, timeout = 30000, retry = 0 } = data;
    const proxy = process.env.WEB_FETCH_PROXY;

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= retry; attempt++) {
      ctx.signal.throwIfAborted();

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      ctx.signal.addEventListener('abort', () => {
        controller.abort(ctx.signal.reason);
      });

      try {
        const response = await this.doFetch(url, controller.signal, proxy);

        clearTimeout(timeoutId);

        const html = await response.text();

        const sanitizedHTML = sanitizeHtml(html);

        const sanitizedDOM = new JSDOM(sanitizedHTML, { url });
        const reader = new Readability(sanitizedDOM.window.document);
        const article = reader.parse();

        if (!article) {
          throw new Error('Failed to extract article content from URL');
        }

        this.logger.info(`Successfully extracted content from: ${url}`);

        return {
          title: article.title || '',
          textContent: article.textContent || '',
          excerpt: article.excerpt || '',
          byline: article.byline || null,
          siteName: article.siteName || null,
          url,
        };
      } catch (error) {
        clearTimeout(timeoutId);
        lastError = error as Error;

        if (attempt < retry) {
          this.logger.warn(
            `Fetch attempt ${attempt + 1} failed, retrying: ${(error as Error).message}`,
          );
        }
      }
    }

    throw lastError;
  }
}
