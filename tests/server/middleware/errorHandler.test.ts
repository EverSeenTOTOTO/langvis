import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

function createMocks() {
  const req = { path: '/api/x', method: 'get' } as unknown as Request;
  const json = vi.fn().mockReturnThis();
  const status = vi.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  return { req, res, next, status, json };
}

async function importHandler() {
  vi.resetModules();
  const { default: errorHandler } = await import(
    '@/server/middleware/errorHandler'
  );
  return errorHandler;
}

describe('errorHandler（错误脱敏）', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllEnvs());

  it('prod：未知错误回泛指消息，底层 err.message 不下网络', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { req, res, next, status, json } = createMocks();
    const errorHandler = await importHandler();

    errorHandler(new Error('relation "user" does not exist'), req, res, next);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ error: 'Internal Server Error' });
  });

  it('dev：保留 err.message 便于调试', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const { req, res, next, status, json } = createMocks();
    const errorHandler = await importHandler();

    errorHandler(new Error('boom-detail'), req, res, next);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ error: 'boom-detail' });
  });

  it('无错误时放行 next', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { req, res, next } = createMocks();
    const errorHandler = await importHandler();

    errorHandler(undefined as unknown as Error, req, res, next);

    expect(next).toHaveBeenCalled();
  });
});
