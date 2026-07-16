import { tool } from '@/server/decorator/tool';
import {
  lifecycleHook,
  type LifecycleHook,
} from '@/server/decorator/lifecycle';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import type { ToolConfig } from '@/shared/types';
import { createTimeoutController } from '@/server/utils/abort';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';
import type { Browser } from 'playwright';
import { chromium } from 'playwright';
import type { ToolCallContext } from '@/server/modules/agent/domain/port/tool-call-context.port';
import type { RunEvent } from '@/shared/types/events';
import { Tool } from '@/server/modules/agent/domain/model/tool.base';
import { sanitizeHtml } from '@/server/utils/sanitizeHtml';
import type { RenderMode, WebFetchInput, WebFetchOutput } from './config';

const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

const CONTENT_RATIO_THRESHOLD = 0.1;

const SPA_ROOT_SELECTORS = ['#root', '#app', '#__next', '#__nuxt'];

@tool(ToolIds.WEB_FETCH)
@lifecycleHook
export default class WebFetchTool
  extends Tool<WebFetchOutput>
  implements LifecycleHook
{
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  private browser: Browser | null = null;

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

  extractContent(
    html: string,
    url: string,
  ): {
    article: ReturnType<Readability['parse']>;
    markdown: string;
  } {
    const sanitizedHTML = sanitizeHtml(html);
    const sanitizedDOM = new JSDOM(sanitizedHTML, { url });
    const reader = new Readability(sanitizedDOM.window.document);
    const article = reader.parse();
    const markdown = article?.content
      ? turndownService.turndown(article.content)
      : '';
    return { article, markdown };
  }

  needsFallback(markdown: string, html: string): boolean {
    // Signal 1: Readability returned null (no article extracted)
    if (!markdown) return true;

    // Signal 2: Content ratio too low (sparse shell HTML)
    if (
      html.length > 1000 &&
      markdown.length / html.length < CONTENT_RATIO_THRESHOLD
    ) {
      return true;
    }

    // Signal 3: SPA markers — empty root div with no text content
    for (const selector of SPA_ROOT_SELECTORS) {
      const match = html.match(
        new RegExp(`<div[^>]*id="${selector.slice(1)}"[^>]*>(.*?)</div>`, 's'),
      );
      if (match && match[1].trim().length === 0) {
        return true;
      }
    }

    return false;
  }

  private async getBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    this.browser = await chromium.launch({ headless: true });
    this.logger.info('Playwright browser launched');
    return this.browser;
  }

  private async fetchWithPlaywright(
    url: string,
    timeout: number,
    signal: AbortSignal,
  ): Promise<string> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();

    try {
      await page.goto(url, {
        waitUntil: 'networkidle',
        timeout,
      });

      signal.throwIfAborted();

      const html = await page.content();
      this.logger.info(`Playwright rendered: ${url}`);
      return html;
    } finally {
      await page.close();
    }
  }

  async *call(
    ctx: ToolCallContext,
  ): AsyncGenerator<RunEvent, WebFetchOutput, void> {
    ctx.signal.throwIfAborted();

    const data = ctx.input as unknown as WebFetchInput;
    const {
      url,
      timeout = 30000,
      retry = 0,
      response_format = 'concise',
      render = 'auto',
    } = data;
    const proxy = process.env.WEB_FETCH_PROXY;
    const renderMode = render as RenderMode;

    if (renderMode === 'browser') {
      const html = await this.fetchWithPlaywright(url, timeout, ctx.signal);
      const { article, markdown } = this.extractContent(html, url);

      if (!article) {
        throw new Error(
          `Failed to extract content from URL even with headless browser. URL: ${url}`,
        );
      }

      yield {
        type: 'tool_progress',
        callId: ctx.callId,
        data: {
          message: `Rendered with headless browser`,
          data: { render: 'browser', contentLength: markdown.length },
        },
      };

      return this.formatOutput(article!, markdown, url, response_format);
    }

    // Static or auto mode: try fetch first
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
        const { article, markdown } = this.extractContent(html, url);

        // Static mode: no fallback, throw if content is sparse
        if (renderMode === 'static') {
          if (!article) {
            throw new Error(
              `Failed to extract content from URL. The page may require JavaScript rendering. Try render="auto" or render="browser". URL: ${url}`,
            );
          }
          return this.formatOutput(article!, markdown, url, response_format);
        }

        // Auto mode: check if fallback is needed
        if (this.needsFallback(markdown, html)) {
          this.logger.info(
            `Content sparse (markdown=${markdown.length}, html=${html.length}), falling back to Playwright: ${url}`,
          );
          cleanup();
          const browserHtml = await this.fetchWithPlaywright(
            url,
            timeout,
            ctx.signal,
          );
          const { article: browserArticle, markdown: browserMarkdown } =
            this.extractContent(browserHtml, url);

          if (browserArticle && browserMarkdown.length > markdown.length) {
            yield {
              type: 'tool_progress',
              callId: ctx.callId,
              data: {
                message: `Content was sparse, re-rendered with headless browser`,
                data: {
                  render: 'auto → browser',
                  fetchLength: markdown.length,
                  browserLength: browserMarkdown.length,
                },
              },
            };
            return this.formatOutput(
              browserArticle,
              browserMarkdown,
              url,
              response_format,
            );
          }

          // Playwright didn't help — return whatever we got from fetch
          if (!article) {
            throw new Error(
              `Failed to extract content from URL even with headless browser fallback. URL: ${url}`,
            );
          }
        }

        return this.formatOutput(article!, markdown, url, response_format);
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

  private formatOutput(
    article: NonNullable<ReturnType<Readability['parse']>>,
    markdown: string,
    url: string,
    format: string,
  ): WebFetchOutput {
    if (format === 'concise') {
      return {
        title: article.title || '',
        content: markdown,
      };
    }

    return {
      title: article.title || '',
      content: markdown,
      excerpt: article.excerpt || '',
      author: article.byline || null,
      siteName: article.siteName || null,
      url,
    };
  }

  async onShutdown(): Promise<void> {
    if (this.browser?.isConnected()) {
      await this.browser.close();
      this.browser = null;
      this.logger.info('Playwright browser closed');
    }
  }
}
