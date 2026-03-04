import { tool } from '@/server/decorator/core';
import { input } from '@/server/decorator/param';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import { AgentEvent, ToolConfig } from '@/shared/types';
import { Readability } from '@mozilla/readability';
import DOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import { container } from 'tsyringe';
import { Tool } from '..';
import { ExecutionContext } from '../../ExecutionContext';
import type HumanInTheLoopTool from '../HumanInTheLoop';

interface WebFetchInput {
  url: string;
  timeout?: number;
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

    const { url, timeout = 30000 } = data;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    ctx.signal.addEventListener('abort', () => {
      controller.abort(ctx.signal.reason);
    });

    let response: Response;

    try {
      response = await this.doFetch(url, controller.signal);
    } catch (error) {
      clearTimeout(timeoutId);

      const proxy = process.env.WEB_FETCH_PROXY;

      if (!proxy) {
        throw error;
      }

      this.logger.warn(
        `Direct fetch failed, asking user about proxy retry: ${(error as Error).message}`,
      );

      const humanInTheLoop = container.resolve<
        HumanInTheLoopTool<{ value?: boolean }>
      >(ToolIds.HUMAN_IN_THE_LOOP);

      const confirmed = yield* humanInTheLoop.call(
        {
          message: `Direct fetch failed: ${(error as Error).message}. A proxy is available. Retry with proxy?`,
          formSchema: {
            type: 'object',
            properties: {
              value: {
                type: 'boolean',
                nullable: true,
                title: 'Use proxy?',
              },
            },
          },
          timeout: 60000,
        },
        ctx,
      );

      if (!confirmed.submitted || confirmed.data?.value !== true) {
        throw error;
      }

      const retryController = new AbortController();
      const retryTimeoutId = setTimeout(() => retryController.abort(), timeout);

      ctx.signal.addEventListener('abort', () => {
        retryController.abort(ctx.signal.reason);
      });

      try {
        response = await this.doFetch(url, retryController.signal, proxy);
      } finally {
        clearTimeout(retryTimeoutId);
      }
    } finally {
      clearTimeout(timeoutId);
    }

    const html = await response.text();

    const dom = new JSDOM(html, { url });
    const purify = DOMPurify(dom.window);

    const sanitizedHTML = purify.sanitize(html, {
      ALLOWED_TAGS: [
        'p',
        'div',
        'span',
        'a',
        'img',
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'ul',
        'ol',
        'li',
        'br',
        'strong',
        'em',
        'code',
        'pre',
        'blockquote',
        'article',
        'section',
        'header',
        'footer',
        'main',
        'table',
        'thead',
        'tbody',
        'tr',
        'th',
        'td',
      ],
      ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'id'],
      KEEP_CONTENT: true,
    });

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
  }
}
