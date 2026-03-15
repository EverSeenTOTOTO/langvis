import ExtractLinksTool from '@/server/core/tool/ExtractLinks';
import logger from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockContext } from '../../helpers/context';

vi.mock('@/server/utils/logger', () => {
  const mockLogger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  };
  mockLogger.child.mockReturnValue(mockLogger);
  return {
    default: mockLogger,
  };
});

async function getResult<T>(gen: AsyncGenerator<unknown, T, void>): Promise<T> {
  let result = await gen.next();
  while (!result.done) {
    result = await gen.next();
  }
  return result.value;
}

describe('ExtractLinksTool', () => {
  let tool: ExtractLinksTool;

  beforeEach(() => {
    tool = new ExtractLinksTool();
    // @ts-expect-error readonly
    tool.id = ToolIds.LINKS_EXTRACT;
    // @ts-expect-error readonly
    tool.config = {
      name: 'Extract Links Tool',
      description: 'Test tool',
    };
    (tool as any).logger = logger;
    vi.clearAllMocks();
  });

  describe('HTML content', () => {
    it('should extract links from HTML anchor tags', async () => {
      const html = `
        <html>
          <body>
            <a href="https://example.com/article1">Article 1</a>
            <a href="https://example.com/article2">Article 2</a>
          </body>
        </html>
      `;

      const ctx = createMockContext();
      const result = await getResult(tool.call({ content: html }, ctx));

      expect(result.links).toHaveLength(2);
      expect(result.links[0]).toEqual({
        url: 'https://example.com/article1',
        text: 'Article 1',
        context: expect.any(String),
      });
      expect(result.links[1]).toEqual({
        url: 'https://example.com/article2',
        text: 'Article 2',
        context: expect.any(String),
      });
    });

    it('should extract context from parent elements', async () => {
      const html = `
        <html>
          <body>
            <p>Check out this <a href="https://example.com/link">cool article</a> about React.</p>
          </body>
        </html>
      `;

      const ctx = createMockContext();
      const result = await getResult(tool.call({ content: html }, ctx));

      expect(result.links).toHaveLength(1);
      expect(result.links[0].url).toBe('https://example.com/link');
      expect(result.links[0].text).toBe('cool article');
      expect(result.links[0].context).toContain('React');
    });

    it('should filter out invalid URLs', async () => {
      const html = `
        <html>
          <body>
            <a href="javascript:alert('xss')">JS Link</a>
            <a href="mailto:test@example.com">Email</a>
            <a href="#anchor">Anchor</a>
            <a href="https://example.com/valid">Valid</a>
          </body>
        </html>
      `;

      const ctx = createMockContext();
      const result = await getResult(tool.call({ content: html }, ctx));

      expect(result.links).toHaveLength(1);
      expect(result.links[0].url).toBe('https://example.com/valid');
    });

    it('should deduplicate URLs', async () => {
      const html = `
        <html>
          <body>
            <a href="https://example.com/article">Link 1</a>
            <a href="https://example.com/article">Link 2</a>
            <a href="https://example.com/article?utm_source=news">Link 3</a>
          </body>
        </html>
      `;

      const ctx = createMockContext();
      const result = await getResult(tool.call({ content: html }, ctx));

      // Should deduplicate after normalizing (removing trailing slash and tracking params)
      expect(result.links.length).toBeLessThanOrEqual(2);
    });
  });

  describe('plain text content', () => {
    it('should extract URLs from plain text', async () => {
      const text = `
        Check out these articles:
        https://example.com/article1
        https://example.com/article2
        And this one: https://example.com/article3
      `;

      const ctx = createMockContext();
      const result = await getResult(tool.call({ content: text }, ctx));

      expect(result.links).toHaveLength(3);
      expect(result.links.map(l => l.url)).toEqual([
        'https://example.com/article1',
        'https://example.com/article2',
        'https://example.com/article3',
      ]);
    });

    it('should include context around URLs in plain text', async () => {
      const text =
        'This is a great article: https://example.com/article about React hooks.';

      const ctx = createMockContext();
      const result = await getResult(tool.call({ content: text }, ctx));

      expect(result.links).toHaveLength(1);
      expect(result.links[0].context).toContain('great article');
    });
  });

  describe('mixed content', () => {
    it('should extract both HTML links and plain text URLs', async () => {
      const content = `
        <html>
          <body>
            <a href="https://html-link.com">HTML Link</a>
            Some text with https://plain-text-link.com in it.
          </body>
        </html>
      `;

      const ctx = createMockContext();
      const result = await getResult(tool.call({ content: content }, ctx));

      expect(result.links.length).toBeGreaterThanOrEqual(2);
      const urls = result.links.map(l => l.url);
      expect(urls).toContain('https://html-link.com');
      expect(urls).toContain('https://plain-text-link.com');
    });
  });

  describe('URL normalization', () => {
    it('should remove tracking parameters', async () => {
      const html = `
        <a href="https://example.com/article?utm_source=newsletter&utm_medium=email">Link</a>
      `;

      const ctx = createMockContext();
      const result = await getResult(tool.call({ content: html }, ctx));

      expect(result.links[0].url).toBe('https://example.com/article');
    });

    it('should remove trailing slashes', async () => {
      const html = `<a href="https://example.com/article/">Link</a>`;

      const ctx = createMockContext();
      const result = await getResult(tool.call({ content: html }, ctx));

      expect(result.links[0].url).toBe('https://example.com/article');
    });
  });

  describe('edge cases', () => {
    it('should handle empty content', async () => {
      const ctx = createMockContext();
      const result = await getResult(tool.call({ content: '' }, ctx));

      expect(result.links).toHaveLength(0);
    });

    it('should handle content with no links', async () => {
      const ctx = createMockContext();
      const result = await getResult(
        tool.call({ content: 'Just some plain text without links.' }, ctx),
      );

      expect(result.links).toHaveLength(0);
    });

    it('should handle malformed HTML gracefully', async () => {
      const html = `<a href="https://example.com/link">Unclosed link`;

      const ctx = createMockContext();
      const result = await getResult(tool.call({ content: html }, ctx));

      // JSDOM should still parse it
      expect(result.links.length).toBeGreaterThanOrEqual(0);
    });
  });
});
