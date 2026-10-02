import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

import type { AuthService } from '@/server/modules/user/infrastructure/auth.service';

const { logInfo } = vi.hoisted(() => ({ logInfo: vi.fn() }));

vi.mock('@/server/utils/logger', () => ({
  default: {
    child: () => ({ info: logInfo, warn: vi.fn(), error: vi.fn() }),
  },
}));

const makeAuthService = (): AuthService =>
  ({ getSessionId: vi.fn().mockResolvedValue(null) }) as unknown as AuthService;

/** 驱动 Nest 中间件一次（请求上下文 + 访问日志都包在 use 里）。每次重求值 isProd。 */
async function fire(
  headers: Record<string, string>,
): Promise<{ req: Request; res: Response }> {
  vi.resetModules();
  const { RequestIdMiddleware: Middleware } = await import(
    '@/server/middleware/requestId'
  );
  const req = {
    headers,
    method: 'GET',
    originalUrl: '/api/test',
  } as unknown as Request;
  const res = { setHeader: vi.fn(), on: vi.fn() } as unknown as Response;
  return new Promise(resolve => {
    new Middleware(makeAuthService()).use(req, res, (() =>
      resolve({ req, res })) as NextFunction);
  });
}

describe('RequestIdMiddleware（请求上下文 + -> 帧 headers 脱敏）', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllEnvs());

  it('装配请求上下文：req.id/req.log/X-Request-Id 头，透传既有 x-request-id', async () => {
    const { req, res } = await fire({
      'x-request-id': 'req_existing',
    });
    expect(req.id).toBe('req_existing');
    expect(req.log).toBeDefined();
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', 'req_existing');
  });

  it('prod：headers 白名单，cookie/authorization 不落日志', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.resetModules();
    await fire({
      cookie: 'session=secret',
      authorization: 'Bearer token',
      'user-agent': 'curl/8',
      'content-type': 'application/json',
    });

    const [msg, payload] = logInfo.mock.calls[0];
    expect(msg).toBe('-> GET /api/test');
    expect(payload.type).toBe('->');
    const keys = Object.keys(payload.headers);
    expect(keys).not.toContain('cookie');
    expect(keys).not.toContain('authorization');
    expect(keys).toEqual(
      expect.arrayContaining(['user-agent', 'content-type']),
    );
  });

  it('dev：headers 全量保留（便于调试，含 cookie/authorization）', async () => {
    await fire({
      cookie: 'session=secret',
      authorization: 'Bearer token',
      'user-agent': 'curl/8',
    });

    const [, payload] = logInfo.mock.calls[0];
    expect(Object.keys(payload.headers)).toEqual(
      expect.arrayContaining(['cookie', 'authorization', 'user-agent']),
    );
  });
});
