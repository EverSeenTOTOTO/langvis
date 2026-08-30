import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response } from 'express';

// 捕获 bindRequestId 注册的两段中间件，直接驱动（不起真实 server）。
// 保留 tsyringe 真实导出与容器原型方法，仅 Proxy 覆盖 container.resolve。
vi.mock('tsyringe', async importOriginal => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    container: new Proxy(actual.container, {
      get(target, prop, receiver) {
        if (prop === 'resolve') {
          return () => ({ getSessionId: () => Promise.resolve(null) });
        }
        return Reflect.get(target, prop, receiver);
      },
    }),
  };
});

vi.mock('@/server/utils/logger', () => {
  const logInfo = vi.fn();
  return {
    default: {
      child: () => ({ info: logInfo, warn: vi.fn(), error: vi.fn() }),
    },
    __logInfo: logInfo,
  };
});

async function setup(env: 'production' | 'development') {
  vi.resetModules();
  vi.stubEnv('NODE_ENV', env);
  const { default: bindRequestId } = await import(
    '@/server/middleware/requestId'
  );
  const loggerMod = await import('@/server/utils/logger');
  const logInfo = (
    loggerMod as unknown as {
      __logInfo: ReturnType<typeof vi.fn>;
    }
  ).__logInfo;

  const uses: Array<{ path?: string; fn: any }> = [];
  const mockApp = {
    use: (pathOrFn: any, fn?: any) => {
      if (typeof pathOrFn === 'string') uses.push({ path: pathOrFn, fn });
      else uses.push({ fn: pathOrFn });
    },
  } as any;

  await bindRequestId(mockApp);
  return { uses, logInfo };
}

function fire(
  uses: Array<{ path?: string; fn: any }>,
  headers: Record<string, string>,
): Promise<void> {
  const req = {
    headers,
    method: 'GET',
    originalUrl: '/api/test',
  } as unknown as Request;
  const res = { setHeader: vi.fn(), on: vi.fn() } as unknown as Response;
  // uses[0]：设 req.log（async，await getSessionId）；uses[1]：/api/* logger，记 -> 帧 headers。
  return new Promise<void>(resolve => {
    uses[0].fn(req, res, () => {
      uses[1].fn(req, res, () => resolve());
    });
  });
}

describe('requestId（-> 帧 headers 脱敏）', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllEnvs());

  it('prod：headers 白名单，cookie/authorization 不落日志', async () => {
    const { uses, logInfo } = await setup('production');
    await fire(uses, {
      cookie: 'session=secret',
      authorization: 'Bearer token',
      'user-agent': 'curl/8',
      'content-type': 'application/json',
    });

    const payload = logInfo.mock.calls[0][0];
    expect(payload.type).toBe('->');
    const keys = Object.keys(payload.headers);
    expect(keys).not.toContain('cookie');
    expect(keys).not.toContain('authorization');
    expect(keys).toEqual(
      expect.arrayContaining(['user-agent', 'content-type']),
    );
  });

  it('dev：headers 全量保留（便于调试，含 cookie/authorization）', async () => {
    const { uses, logInfo } = await setup('development');
    await fire(uses, {
      cookie: 'session=secret',
      authorization: 'Bearer token',
      'user-agent': 'curl/8',
    });

    const payload = logInfo.mock.calls[0][0];
    expect(Object.keys(payload.headers)).toEqual(
      expect.arrayContaining(['cookie', 'authorization', 'user-agent']),
    );
  });
});
