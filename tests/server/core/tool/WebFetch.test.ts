import WebFetchTool from '@/server/core/tool/WebFetch';
import { ExecutionContext } from '@/server/core/context';
import { runTool } from '@/server/utils';
import logger from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

function createMockContext(): ExecutionContext {
  return ExecutionContext.create('test-trace-id', new AbortController().signal);
}

describe('WebFetchTool', () => {
  let tool: WebFetchTool;

  beforeEach(() => {
    tool = new WebFetchTool();
    // @ts-expect-error readonly
    tool.id = ToolIds.WEB_FETCH;
    // @ts-expect-error readonly
    tool.config = {
      name: { en: 'Web Fetch Tool' },
      description: { en: 'Test tool' },
    };
    (tool as any).logger = logger;
  });

  it('should reject empty URL', async () => {
    const ctx = createMockContext();
    await expect(runTool(tool.call({ url: '' }, ctx))).rejects.toThrow(
      'Failed to parse URL from ',
    );
  });

  it('should reject invalid URL', async () => {
    const ctx = createMockContext();
    await expect(
      runTool(tool.call({ url: 'not-a-valid-url' }, ctx)),
    ).rejects.toThrow('Failed to parse URL from not-a-valid-url');
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

    const ctx = createMockContext();
    const result = await runTool(
      tool.call({ url: 'https://example.com/article' }, ctx),
    );

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

    const ctx = createMockContext();
    await expect(
      runTool(tool.call({ url: 'https://example.com/nonexistent' }, ctx)),
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

    const ctx = createMockContext();
    const result = await runTool(
      tool.call({ url: 'https://example.com/malicious' }, ctx),
    );

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

    const ctx = createMockContext();
    await expect(
      runTool(
        tool.call({ url: 'https://example.com/slow', timeout: 100 }, ctx),
      ),
    ).rejects.toThrow();
  });
});
