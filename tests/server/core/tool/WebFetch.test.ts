import WebFetchTool from '@/server/core/tool/WebFetch';
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

const mockHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Test Article</title>
</head>
<body>
  <article>
    <h1>Test Article Title</h1>
    <p>This is a test article with sufficient content for Readability parsing. The content needs to be long enough for the parser to consider it a valid article. We add more sentences to ensure proper extraction.</p>
    <p>More content here to ensure proper article extraction. Readability requires enough paragraph content to determine if this is an actual article worth reading.</p>
    <p>Third paragraph with additional content to meet the minimum content threshold for article detection in Mozilla's Readability library.</p>
  </article>
</body>
</html>
`;

describe('WebFetchTool', () => {
  let tool: WebFetchTool;
  let originalProxyEnv: string | undefined;

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
    originalProxyEnv = process.env.WEB_FETCH_PROXY;
    delete process.env.WEB_FETCH_PROXY;
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.WEB_FETCH_PROXY = originalProxyEnv;
  });

  it('should reject empty URL', async () => {
    const ctx = createMockContext();
    await expect(getResult(tool.call({ url: '' }, ctx))).rejects.toThrow(
      'Failed to parse URL from ',
    );
  });

  it('should reject invalid URL', async () => {
    const ctx = createMockContext();
    await expect(
      getResult(tool.call({ url: 'not-a-valid-url' }, ctx)),
    ).rejects.toThrow('Failed to parse URL from not-a-valid-url');
  });

  it('should fetch and extract content from a valid URL', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => mockHTML,
    });

    const ctx = createMockContext();
    const result = await getResult(
      tool.call({ url: 'https://example.com/article' }, ctx),
    );

    expect(result).toHaveProperty('title');
    expect(result).toHaveProperty('content');
    expect((result as { content: string }).content).toContain('test article');
  });

  it('should handle fetch errors', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    const ctx = createMockContext();
    await expect(
      getResult(tool.call({ url: 'https://example.com/nonexistent' }, ctx)),
    ).rejects.toThrow('Failed to fetch URL (404 Not Found)');
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
    const result = await getResult(
      tool.call({ url: 'https://example.com/malicious' }, ctx),
    );

    expect(result.content).not.toContain('<script>');
    expect(result.content).not.toContain('onclick');
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
      getResult(
        tool.call({ url: 'https://example.com/slow', timeout: 100 }, ctx),
      ),
    ).rejects.toThrow();
  });
});

describe('WebFetchTool - proxy and retry', () => {
  let tool: WebFetchTool;
  let originalEnv: string | undefined;

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
    originalEnv = process.env.WEB_FETCH_PROXY;
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.WEB_FETCH_PROXY = originalEnv;
  });

  it('should use proxy by default when available', async () => {
    process.env.WEB_FETCH_PROXY = 'http://proxy:8080';

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => mockHTML,
    });

    const ctx = createMockContext();
    await getResult(tool.call({ url: 'https://example.com/article' }, ctx));

    expect(global.fetch).toHaveBeenCalledWith(
      'https://example.com/article',
      expect.objectContaining({
        proxy: 'http://proxy:8080',
      }),
    );
  });

  it('should throw error when no proxy available and fetch fails', async () => {
    delete process.env.WEB_FETCH_PROXY;

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
    });

    const ctx = createMockContext();
    await expect(
      getResult(tool.call({ url: 'https://example.com/blocked' }, ctx)),
    ).rejects.toThrow('Failed to fetch URL (403 Forbidden)');
  });

  it('should retry specified number of times on failure', async () => {
    delete process.env.WEB_FETCH_PROXY;

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => mockHTML,
      });

    const ctx = createMockContext();
    const result = await getResult(
      tool.call({ url: 'https://example.com/flaky', retry: 1 }, ctx),
    );

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(result.content).toContain('test article');
  });

  it('should log warning on retry attempts', async () => {
    delete process.env.WEB_FETCH_PROXY;

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    const ctx = createMockContext();
    await expect(
      getResult(
        tool.call({ url: 'https://example.com/failing', retry: 2 }, ctx),
      ),
    ).rejects.toThrow();

    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Fetch attempt 1 failed'),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Fetch attempt 2 failed'),
    );
  });

  it('should throw after all retries exhausted', async () => {
    delete process.env.WEB_FETCH_PROXY;

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
    });

    const ctx = createMockContext();
    await expect(
      getResult(tool.call({ url: 'https://example.com/down', retry: 3 }, ctx)),
    ).rejects.toThrow('Failed to fetch URL (503 Service Unavailable)');

    expect(global.fetch).toHaveBeenCalledTimes(4); // initial + 3 retries
  });
});

describe('WebFetchTool - needsFallback', () => {
  let tool: WebFetchTool;

  beforeEach(() => {
    tool = new WebFetchTool();
    (tool as any).logger = logger;
  });

  it('should fallback when markdown is empty (Readability failed)', () => {
    expect(tool.needsFallback('', '<html><body></body></html>')).toBe(true);
  });

  it('should not fallback when content is rich', () => {
    const html = mockHTML;
    // Use extractContent to get real markdown
    const { markdown } = tool.extractContent(html, 'https://example.com');
    expect(tool.needsFallback(markdown, html)).toBe(false);
  });

  it('should fallback when content ratio is too low', () => {
    // 50KB HTML shell with only 100 chars of extracted content
    const bigHtml = 'x'.repeat(50000);
    expect(tool.needsFallback('x'.repeat(100), bigHtml)).toBe(true);
  });

  it('should not fallback for short pages (ratio check only for large HTML)', () => {
    // 500 chars HTML with 10 chars content — ratio is 2% but HTML is too short to trigger
    expect(tool.needsFallback('x'.repeat(10), 'y'.repeat(500))).toBe(false);
  });

  it('should fallback when SPA root div is empty', () => {
    const spaHtml = `
      <!DOCTYPE html>
      <html>
        <head><title>SPA</title></head>
        <body>
          <div id="root"></div>
          <script src="/bundle.js"></script>
        </body>
      </html>
    `;
    // Readability will likely return null for this, but test SPA detection directly
    const { markdown } = tool.extractContent(spaHtml, 'https://example.com');
    expect(tool.needsFallback(markdown, spaHtml)).toBe(true);
  });

  it('should not fallback when SPA root div has content', () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head><title>Article</title></head>
        <body>
          <div id="root">
            <article>
              <h1>Title</h1>
              <p>Content paragraph with enough text for Readability to parse successfully. We need multiple paragraphs to ensure the article is detected properly by the parser algorithm.</p>
              <p>Another paragraph with more content to ensure proper extraction by the Readability library.</p>
              <p>Third paragraph to meet the minimum threshold requirements for article detection.</p>
            </article>
          </div>
        </body>
      </html>
    `;
    const { markdown } = tool.extractContent(html, 'https://example.com');
    expect(tool.needsFallback(markdown, html)).toBe(false);
  });
});

describe('WebFetchTool - render modes', () => {
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
    vi.clearAllMocks();
  });

  it('should skip fetch when render=browser', async () => {
    // Mock fetch to ensure it's NOT called
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
    });

    // Mock Playwright — can't fully mock in unit test,
    // but verify fetch is not called for render=browser
    // This test verifies the code path; actual Playwright testing needs integration
    const ctx = createMockContext();

    // render=browser will try Playwright which won't work in unit test env,
    // so we mock getBrowser to throw, verifying the path was taken
    const spy = vi.spyOn(tool as any, 'getBrowser').mockImplementation(() => {
      throw new Error('Playwright not available in test');
    });

    await expect(
      getResult(
        tool.call({ url: 'https://example.com/spa', render: 'browser' }, ctx),
      ),
    ).rejects.toThrow('Playwright not available in test');

    expect(global.fetch).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('should not fallback when render=static even if content is sparse', async () => {
    const sparseHtml = `
      <!DOCTYPE html>
      <html>
        <head><title>Sparse</title></head>
        <body>
          <div id="root"></div>
          <script src="/bundle.js"></script>
        </body>
      </html>
    `;

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => sparseHtml,
    });

    const ctx = createMockContext();
    await expect(
      getResult(
        tool.call({ url: 'https://example.com/spa', render: 'static' }, ctx),
      ),
    ).rejects.toThrow('may require JavaScript rendering');
  });

  it('should use auto mode by default with fallback', async () => {
    // First fetch returns sparse content, then Playwright fallback provides rich content
    const sparseHtml = `
      <!DOCTYPE html>
      <html>
        <head><title>SPA Page</title></head>
        <body><div id="root"></div><script src="/app.js"></script></body>
      </html>
    `;

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => sparseHtml,
    });

    // Mock Playwright to return rich content
    vi.spyOn(tool as any, 'fetchWithPlaywright').mockResolvedValue(mockHTML);

    const ctx = createMockContext();
    const result = await getResult(
      tool.call({ url: 'https://example.com/spa' }, ctx),
    );

    expect(result).toHaveProperty('content');
    expect(result.content.length).toBeGreaterThan(0);
  });
});
