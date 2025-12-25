import { describe, it, beforeEach, afterEach, vi, expect } from 'vitest';
import AuthController from '@/server/controller/AuthController';
import { AuthService } from '@/server/service/AuthService';
import type { Request } from 'express';

// Create a proper mock for AuthService
const mockAuthService = {
  api: {
    signInEmail: vi.fn(),
    signUpEmail: vi.fn(),
    signOut: vi.fn(),
  },
} as unknown as AuthService;

// Mock request and response objects
const mockRequest = (body: any = {}, headers: any = {}) =>
  ({
    body,
    headers,
  }) as unknown as Request;

const mockResponse = () => {
  const res: any = {};
  res.set = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

describe('AuthController', () => {
  let authController: AuthController;

  beforeEach(() => {
    // Create controller with mocked service
    authController = new AuthController(mockAuthService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should be defined', () => {
    expect(authController).toBeDefined();
  });

  describe('signIn', () => {
    it('should call authService.api.signInEmail and set cookies', async () => {
      const req = mockRequest({
        email: 'test@example.com',
        password: 'password',
      });
      const res = mockResponse();

      const mockResponseData = {
        user: { id: '1' },
        session: { token: 'token' },
      };
      const mockHeaders = {
        getSetCookie: vi.fn().mockReturnValue(['cookie=value']),
      };

      (mockAuthService.api.signInEmail as any).mockResolvedValue({
        headers: mockHeaders,
        response: mockResponseData,
      } as any);

      await authController.signIn(req, res);

      expect(mockAuthService.api.signInEmail).toHaveBeenCalledWith({
        returnHeaders: true,
        body: req.body,
      });

      expect(res.set).toHaveBeenCalledWith('set-cookie', ['cookie=value']);
      expect(res.json).toHaveBeenCalledWith(mockResponseData);
    });
  });

  describe('signUp', () => {
    it('should call authService.api.signUpEmail and set cookies', async () => {
      const req = mockRequest({
        email: 'test@example.com',
        password: 'password',
      });
      const res = mockResponse();

      const mockResponseData = {
        user: { id: '1' },
        session: { token: 'token' },
      };
      const mockHeaders = {
        getSetCookie: vi.fn().mockReturnValue(['cookie=value']),
      };

      (mockAuthService.api.signUpEmail as any).mockResolvedValue({
        headers: mockHeaders,
        response: mockResponseData,
      } as any);

      await authController.signUp(req, res);

      expect(mockAuthService.api.signUpEmail).toHaveBeenCalledWith({
        returnHeaders: true,
        body: req.body,
      });

      expect(res.set).toHaveBeenCalledWith('set-cookie', ['cookie=value']);
      expect(res.json).toHaveBeenCalledWith(mockResponseData);
    });
  });

  describe('signOut', () => {
    it('should call authService.api.signOut and clear cookies', async () => {
      const req = mockRequest({}, { cookie: 'session=abc123' });
      const res = mockResponse();

      const mockHeaders = {
        getSetCookie: vi.fn().mockReturnValue(['session=; Max-Age=0']),
      };

      (mockAuthService.api.signOut as any).mockResolvedValue({
        headers: mockHeaders,
      } as any);

      await authController.signOut(req, res);

      expect(mockAuthService.api.signOut).toHaveBeenCalledWith({
        headers: {
          cookie: 'session=abc123',
        },
      });

      expect(res.set).toHaveBeenCalledWith('set-cookie', [
        'session=; Max-Age=0',
      ]);
      expect(res.json).toHaveBeenCalledWith({ success: true });
    });
  });
});
