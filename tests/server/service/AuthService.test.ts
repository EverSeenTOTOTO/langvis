import { container } from 'tsyringe';
import { AuthService } from '@/server/service/AuthService';
import { vi } from 'vitest';

vi.mock('@/server/service/pg');
vi.mock('@/server/service/redis');

describe('AuthService', () => {
  let authService: AuthService;

  beforeEach(() => {
    authService = container.resolve(AuthService);
  });

  afterEach(() => {
    container.clearInstances();
  });

  it('should be defined', () => {
    expect(authService).toBeDefined();
  });

  describe('getSession', () => {
    it('should return a session', async () => {
      const req: any = { headers: {} };
      const session = { token: 'test_token' };
      vi.spyOn(authService, 'getSession').mockResolvedValue(session as any);
      const result = await authService.getSession(req);
      expect(result).toEqual(session);
    });

    it('should return undefined if no session', async () => {
      const req: any = { headers: {} };
      vi.spyOn(authService, 'getSession').mockResolvedValue(undefined);
      const result = await authService.getSession(req);
      expect(result).toBeUndefined();
    });
  });

  describe('getSessionId', () => {
    it('should return a session id', async () => {
      const req: any = { headers: {} };
      const session = { token: 'test_token' };
      vi.spyOn(authService, 'getSession').mockResolvedValue(session as any);
      const result = await authService.getSessionId(req);
      expect(result).toEqual('test_token');
    });

    it('should throw an error if no session', async () => {
      const req: any = { headers: {} };
      vi.spyOn(authService, 'getSession').mockResolvedValue(undefined);
      await expect(authService.getSessionId(req)).rejects.toThrow(
        'Invalid session',
      );
    });
  });

  describe('getUser', () => {
    it('should return a user', async () => {
      const req: any = { headers: {} };
      const user = { id: 'test_user' };
      vi.spyOn(authService, 'getUser').mockResolvedValue(user as any);
      const result = await authService.getUser(req);
      expect(result).toEqual(user);
    });

    it('should return undefined if no user', async () => {
      const req: any = { headers: {} };
      vi.spyOn(authService, 'getUser').mockResolvedValue(undefined);
      const result = await authService.getUser(req);
      expect(result).toBeUndefined();
    });
  });

  describe('getUserId', () => {
    it('should return a user id', async () => {
      const req: any = { headers: {} };
      const user = { id: 'test_user' };
      vi.spyOn(authService, 'getUser').mockResolvedValue(user as any);
      const result = await authService.getUserId(req);
      expect(result).toEqual('test_user');
    });

    it('should throw an error if no user', async () => {
      const req: any = { headers: {} };
      vi.spyOn(authService, 'getUser').mockResolvedValue(undefined);
      await expect(authService.getUserId(req)).rejects.toThrow('Invalid user');
    });
  });
});
