import authMiddleware from '@/server/middleware/auth';
import { AUTH_PORT } from '@/server/modules/user/user.di-tokens';
import type { AuthPort } from '@/server/modules/user/domain/port/auth.port';
import { TraceContext } from '@/server/middleware/trace-context';
import { Express, Request, Response } from 'express';
import { container } from 'tsyringe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock AuthPort — abstract interface, not infrastructure
const mockAuthPort: AuthPort = {
  isAuthenticated: vi.fn(),
  getUser: vi.fn(),
  getSession: vi.fn(),
  getSessionId: vi.fn(),
  getUserId: vi.fn(),
};

// Mock container to resolve AuthPort
vi.mock('tsyringe', async importOriginal => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    container: {
      ...actual.container,
      resolve: vi.fn((token: any) => {
        if (token === AUTH_PORT) return mockAuthPort;
        return actual.container.resolve(token);
      }),
      register: vi.fn(),
    },
  };
});

const createMockRequest = (
  path: string,
  headers: Record<string, string> = {},
) => {
  return {
    path,
    headers,
    user: undefined,
  } as unknown as Request;
};

const createMockResponse = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as unknown as Response;
};

const mockApp = {
  use: vi.fn(),
} as unknown as Express;

describe('Auth Middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should resolve AuthPort from DI container', async () => {
    await authMiddleware(mockApp);
    expect(container.resolve).toHaveBeenCalledWith(AUTH_PORT);
  });

  it('should allow access to exempt paths without authentication', async () => {
    await authMiddleware(mockApp);
    const [_path, middleware] = (mockApp.use as any).mock.calls[0];

    const req = createMockRequest('/auth/sign-in/email');
    const res = createMockResponse();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(mockAuthPort.isAuthenticated).not.toHaveBeenCalled();
  });

  it('should allow access for authenticated users', async () => {
    (mockAuthPort.isAuthenticated as any).mockResolvedValue(true);
    (mockAuthPort.getUser as any).mockResolvedValue({ id: 'user_123' });

    await authMiddleware(mockApp);
    const [_path, middleware] = (mockApp.use as any).mock.calls[0];

    const req = createMockRequest('/chat');
    const res = createMockResponse();
    const next = vi.fn();

    // Run inside TraceContext so TraceContext.update({ userId }) doesn't throw
    await TraceContext.run({ requestId: 'test-req' }, async () => {
      await middleware(req, res, next);
    });

    expect(mockAuthPort.isAuthenticated).toHaveBeenCalledWith(req);
    expect(mockAuthPort.getUser).toHaveBeenCalledWith(req);
    expect(req.user).toEqual({ id: 'user_123' });
    expect(next).toHaveBeenCalled();
  });

  it('should deny access for unauthenticated users', async () => {
    (mockAuthPort.isAuthenticated as any).mockResolvedValue(false);

    await authMiddleware(mockApp);
    const [_path, middleware] = (mockApp.use as any).mock.calls[0];

    const req = createMockRequest('/users');
    const res = createMockResponse();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('should handle authentication errors gracefully', async () => {
    (mockAuthPort.isAuthenticated as any).mockRejectedValue(
      new Error('Auth error'),
    );

    await authMiddleware(mockApp);
    const [_path, middleware] = (mockApp.use as any).mock.calls[0];

    const req = createMockRequest('/users');
    const res = createMockResponse();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
  });
});
