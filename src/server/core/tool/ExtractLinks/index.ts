import { tool } from '@/server/decorator/core';
import { input } from '@/server/decorator/param';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import type { AgentEvent, ToolConfig } from '@/shared/types';
import { JSDOM } from 'jsdom';
import { Tool } from '..';
import { ExecutionContext } from '../../ExecutionContext';
import type { ExtractLinksInput, ExtractLinksOutput, LinkInfo } from './config';

@tool(ToolIds.LINKS_EXTRACT)
export default class ExtractLinksTool extends Tool<
  ExtractLinksInput,
  ExtractLinksOutput
> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  async *call(
    @input() data: ExtractLinksInput,
    ctx: ExecutionContext,
  ): AsyncGenerator<AgentEvent, ExtractLinksOutput, void> {
    ctx.signal.throwIfAborted();

    const { content } = data;
    const links: LinkInfo[] = [];

    // Extract from HTML if it looks like HTML
    if (this.looksLikeHtml(content)) {
      links.push(...this.extractFromHtml(content));
    }

    // Also extract plain URLs from text
    links.push(...this.extractFromText(content));

    // Deduplicate and filter
    const result = this.deduplicateAndFilter(links);

    this.logger.info(`Extracted ${result.length} unique links from content`);

    return { links: result };
  }

  private looksLikeHtml(content: string): boolean {
    return /<[a-z][^>]*>/i.test(content);
  }

  private extractFromHtml(html: string): LinkInfo[] {
    const links: LinkInfo[] = [];

    try {
      const dom = new JSDOM(html);
      const doc = dom.window.document;
      const anchorElements = doc.querySelectorAll('a[href]');

      anchorElements.forEach(anchor => {
        const href = anchor.getAttribute('href');
        if (!href || !this.isValidUrl(href)) return;

        const text = anchor.textContent?.trim() || '';
        const context = this.extractContext(anchor);

        links.push({
          url: href,
          text,
          context,
        });
      });
    } catch (error) {
      this.logger.warn(
        `Failed to parse HTML: ${(error as Error)?.message ?? String(error)}`,
      );
    }

    return links;
  }

  private extractFromText(text: string): LinkInfo[] {
    const links: LinkInfo[] = [];
    // Match http/https URLs
    const urlRegex = /https?:\/\/[^\s<>"{}|^`\][\]]+/gi;
    let match;

    while ((match = urlRegex.exec(text)) !== null) {
      const url = match[0];
      const context = this.extractTextContext(text, match.index, url.length);

      links.push({
        url,
        text: '',
        context,
      });
    }

    return links;
  }

  private extractContext(element: Element): string {
    // Get parent element's text, limited to ~100 chars
    let parent = element.parentElement;
    let context = '';

    // Try to get meaningful context from parent or grandparent
    for (let i = 0; i < 2 && parent; i++) {
      const text = parent.textContent?.trim() || '';
      if (text.length > 10) {
        context = text.slice(0, 100);
        break;
      }
      parent = parent.parentElement;
    }

    // If no parent context, use sibling text
    if (!context) {
      const prevSibling = element.previousElementSibling;
      const nextSibling = element.nextElementSibling;
      context =
        (prevSibling?.textContent?.trim() || '') +
        ' ' +
        (nextSibling?.textContent?.trim() || '');
      context = context.trim().slice(0, 100);
    }

    return context;
  }

  private extractTextContext(
    text: string,
    index: number,
    length: number,
  ): string {
    const start = Math.max(0, index - 50);
    const end = Math.min(text.length, index + length + 50);
    return text.slice(start, end).trim();
  }

  private isValidUrl(url: string): boolean {
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return false;
    }

    // Filter out common non-content URLs
    const invalidPatterns = [
      /^javascript:/i,
      /^mailto:/i,
      /^tel:/i,
      /^data:/i,
      /^#/i,
    ];

    for (const pattern of invalidPatterns) {
      if (pattern.test(url)) return false;
    }

    return true;
  }

  private deduplicateAndFilter(links: LinkInfo[]): LinkInfo[] {
    const seen = new Set<string>();
    const result: LinkInfo[] = [];

    for (const link of links) {
      // Normalize URL for deduplication
      const normalizedUrl = this.normalizeUrl(link.url);

      if (!seen.has(normalizedUrl) && this.isValidUrl(link.url)) {
        seen.add(normalizedUrl);
        result.push({
          ...link,
          url: normalizedUrl,
        });
      }
    }

    return result;
  }

  private normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      // Remove trailing slash and common tracking params
      let normalized = parsed.origin + parsed.pathname.replace(/\/$/, '');

      // Keep query params but remove common tracking ones
      const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign'];
      const searchParams = new URLSearchParams(parsed.search);
      trackingParams.forEach(param => searchParams.delete(param));

      const queryString = searchParams.toString();
      if (queryString) {
        normalized += '?' + queryString;
      }

      return normalized;
    } catch {
      return url;
    }
  }
}
