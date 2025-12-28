import { ToolIds } from '@/shared/constants';
import WebFetchTool from '@/server/core/tool/WebFetch';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('WebFetchTool', () => {
  let tool: WebFetchTool;

  beforeEach(() => {
    tool = new WebFetchTool();
    tool.id = ToolIds.WEB_FETCH;
    tool.config = {
      name: { en: 'Web Fetch Tool' },
      description: { en: 'Test tool' },
    };
  });

  it('should reject empty URL', async () => {
    await expect(tool.call({ url: '' })).rejects.toThrow('URL cannot be empty');
  });

  it('should reject invalid URL', async () => {
    await expect(tool.call({ url: 'not-a-valid-url' })).rejects.toThrow(
      'Invalid URL',
    );
  });

  it('should fetch and extract content from a valid URL', async () => {
    const mockHTML = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Test Article - Example Site</title>
          <meta name="author" content="Test Author">
        </head>
        <body>
          <header>Site Header</header>
          <article>
            <h1>Test Article Title</h1>
            <p>This is a test article with some content that is long enough for Readability to parse.</p>
            <p>It has multiple paragraphs with sufficient content to be considered a valid article.</p>
            <p>Adding more content here to ensure the article parser recognizes this as the main content.</p>
            <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.</p>
          </article>
          <footer>Site Footer</footer>
        </body>
      </html>
    `;

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => mockHTML,
    });

    const result = await tool.call({ url: 'https://example.com/article' });

    expect(result).toHaveProperty('title');
    expect(result).toHaveProperty('textContent');
    expect(result).toHaveProperty('url', 'https://example.com/article');
    expect(result.textContent).toContain('test article');
  });

  it('should handle fetch errors', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    await expect(
      tool.call({ url: 'https://example.com/nonexistent' }),
    ).rejects.toThrow('Failed to fetch URL: 404 Not Found');
  });

  it('should sanitize malicious content', async () => {
    const maliciousHTML = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Malicious Page</title>
        </head>
        <body>
          <article>
            <h1>Article Title</h1>
            <p>Normal content</p>
            <script>alert('XSS')</script>
            <p onclick="malicious()">More content</p>
          </article>
        </body>
      </html>
    `;

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => maliciousHTML,
    });

    const result = await tool.call({ url: 'https://example.com/malicious' });

    expect(result.textContent).not.toContain('<script>');
    expect(result.textContent).not.toContain('onclick');
  });

  it('should respect timeout parameter', async () => {
    global.fetch = vi.fn().mockImplementation(() => {
      return new Promise((_, reject) => {
        setTimeout(() => {
          const error = new Error('The operation was aborted');
          error.name = 'AbortError';
          reject(error);
        }, 150);
      });
    });

    await expect(
      tool.call({ url: 'https://example.com/slow', timeout: 100 }),
    ).rejects.toThrow();
  });
});

