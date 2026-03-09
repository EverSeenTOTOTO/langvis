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
  <html>
    <head><title>Test Article</title></head>
    <body>
      <article>
        <h1>Test Article Title</h1>
        <p>This is a test article with sufficient content for Readability parsing.</p>
        <p>More content here to ensure proper article extraction.</p>
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
      getResult(tool.call({ url: 'https://example.com/nonexistent' }, ctx)),
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
    const result = await getResult(
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
    ).rejects.toThrow('Failed to fetch URL: 403 Forbidden');
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
    expect(result.textContent).toContain('test article');
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
    ).rejects.toThrow('Failed to fetch URL: 503 Service Unavailable');

    expect(global.fetch).toHaveBeenCalledTimes(4); // initial + 3 retries
  });
});
