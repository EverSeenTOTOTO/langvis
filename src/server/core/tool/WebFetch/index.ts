import { tool } from '@/server/decorator/config';
import Logger from '@/server/service/logger';
import { ToolIds } from '@/shared/constants';
import { ToolConfig } from '@/shared/types';
import { Readability } from '@mozilla/readability';
import DOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import { Tool } from '..';

export interface WebFetchInput {
  url: string;
  timeout?: number;
}

export interface WebFetchOutput {
  title: string;
  // content: string;
  textContent: string;
  excerpt: string;
  byline: string | null;
  siteName: string | null;
  url: string;
}

@tool(ToolIds.WEB_FETCH)
export default class WebFetchTool extends Tool {
  id!: string;
  config!: ToolConfig;

  private readonly logger = Logger.child({ source: ToolIds.WEB_FETCH });

  async call(input: Record<string, any>): Promise<WebFetchOutput> {
    const { url, timeout = 30000 } = input as WebFetchInput;

    if (!url || !url.trim()) {
      throw new Error('URL cannot be empty');
    }

    try {
      new URL(url);
    } catch {
      throw new Error(`Invalid URL: ${url}`);
    }

    this.logger.info(`Fetching content from: ${url}`);

    if (process.env.WEB_FETCH_PROXY) {
      this.logger.info(`Using proxy: ${process.env.WEB_FETCH_PROXY}`);
    }

    const fetchOptions: RequestInit = {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      },
      signal: AbortSignal.timeout(timeout),
      // @ts-expect-error bun fetch option
      proxy: process.env.WEB_FETCH_PROXY,
    };

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      throw new Error(
        `Failed to fetch URL: ${response.status} ${response.statusText}`,
      );
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
      // content: article.content || '',
      textContent: article.textContent || '',
      excerpt: article.excerpt || '',
      byline: article.byline || null,
      siteName: article.siteName || null,
      url,
    };
  }
}

