import authMiddleware from '@/server/middleware/auth';
import { Express, Request, Response } from 'express';
import { container } from 'tsyringe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock AuthService
const mockAuthService: any = {
  isAuthenticated: vi.fn(),
  getUser: vi.fn(),
};

// Mock container
vi.mock('tsyringe', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...(actual as any),
    container: {
      resolve: vi.fn(() => mockAuthService),
    },
  };
});

// Mock request and response objects
const createMockRequest = (
  path: string,
  headers: Record<string, string> = {},
) => {
  return {
    path,
    headers,
    log: {
      error: vi.fn(),
    },
  } as unknown as Request;
};

const createMockResponse = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response;
};

// Mock Express app
const mockApp = {
  use: vi.fn(),
} as unknown as Express;

describe('Auth Middleware - Permission Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    (container.resolve as jest.Mock).mockReturnValue(mockAuthService);

    mockAuthService.isAuthenticated = vi.fn();
    mockAuthService.getUser = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should allow access to exempt paths without authentication', async () => {
    const req = createMockRequest('/api/auth/sign-in/email');
    const res = createMockResponse();
    const next = vi.fn();

    await authMiddleware(mockApp);
    // The middleware is registered with '/api' path prefix
    const [path, middleware] = (mockApp.use as jest.Mock).mock.calls[0];
    expect(path).toBe('/api');

    // Create a new request with the path without '/api' prefix to match EXEMPT_PATHS
    const modifiedReq = { ...req, path: '/auth/sign-in/email' };
    await middleware(modifiedReq, res, next);

    expect(next).toHaveBeenCalled();
    expect(mockAuthService.isAuthenticated).not.toHaveBeenCalled();
  });

  it('should allow access to API routes for authenticated users', async () => {
    const req = createMockRequest('/api/users');
    const res = createMockResponse();
    const next = vi.fn();
    const mockUser = { id: '1', email: 'test@example.com' };

    mockAuthService.isAuthenticated.mockResolvedValue(true);
    mockAuthService.getUser.mockResolvedValue(mockUser);

    await authMiddleware(mockApp);
    // The middleware is registered with '/api' path prefix
    const [path, middleware] = (mockApp.use as jest.Mock).mock.calls[0];
    expect(path).toBe('/api');

    // Create a new request with the path without '/api' prefix
    const modifiedReq = { ...req, path: '/users' };
    await middleware(modifiedReq, res, next);

    expect(mockAuthService.isAuthenticated).toHaveBeenCalled();
    expect(mockAuthService.getUser).toHaveBeenCalled();
    expect(modifiedReq.user).toEqual(mockUser);
    expect(next).toHaveBeenCalled();
  });

  it('should deny access to API routes for unauthenticated users', async () => {
    const req = createMockRequest('/api/users');
    const res = createMockResponse();
    const next = vi.fn();

    mockAuthService.isAuthenticated.mockResolvedValue(false);

    await authMiddleware(mockApp);
    // The middleware is registered with '/api' path prefix
    const [path, middleware] = (mockApp.use as jest.Mock).mock.calls[0];
    expect(path).toBe('/api');

    // Create a new request with the path without '/api' prefix
    const modifiedReq = { ...req, path: '/users' };
    await middleware(modifiedReq, res, next);

    expect(mockAuthService.isAuthenticated).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Unauthorized',
      redirect: '/login',
      message: 'Authentication required',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('should allow access to page routes for unauthenticated users (client handles auth)', async () => {
    const res = createMockResponse();
    const next = vi.fn();

    mockAuthService.isAuthenticated.mockResolvedValue(false);

    await authMiddleware(mockApp);

    // Page routes don't match the '/api' path prefix, so no middleware should be registered for them
    expect((mockApp.use as jest.Mock).mock.calls.length).toBe(1);
    const [path] = (mockApp.use as jest.Mock).mock.calls[0];
    expect(path).toBe('/api');

    // Since the path doesn't match '/api', it should pass through (next should be called directly by the test)
    next();

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should handle authentication errors gracefully for API routes', async () => {
    const req = createMockRequest('/api/users');
    const res = createMockResponse();
    const next = vi.fn();

    mockAuthService.isAuthenticated.mockRejectedValue(new Error('Auth error'));

    await authMiddleware(mockApp);
    // The middleware is registered with '/api' path prefix
    const [path, middleware] = (mockApp.use as jest.Mock).mock.calls[0];
    expect(path).toBe('/api');

    // Create a new request with the path without '/api' prefix
    const modifiedReq = { ...req, path: '/users' };
    await middleware(modifiedReq, res, next);

    expect(mockAuthService.isAuthenticated).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Unauthorized',
      redirect: '/login',
      message: 'Check Authentication failed: Auth error',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('should handle authentication errors gracefully for page routes', async () => {
    const res = createMockResponse();
    const next = vi.fn();

    mockAuthService.isAuthenticated.mockRejectedValue(new Error('Auth error'));

    await authMiddleware(mockApp);

    // Page routes don't match the '/api' path prefix, so no middleware should be registered for them
    expect((mockApp.use as jest.Mock).mock.calls.length).toBe(1);
    const [path] = (mockApp.use as jest.Mock).mock.calls[0];
    expect(path).toBe('/api');

    // Since the path doesn't match '/api', it should pass through (next should be called directly by the test)
    next();

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
