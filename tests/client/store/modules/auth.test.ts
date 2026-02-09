import { describe, it, expect, vi, beforeEach } from 'vitest';
import { container } from 'tsyringe';
import { AuthStore } from '@/client/store/modules/auth';
import { UserStore } from '@/client/store/modules/user';

vi.mock('better-auth/react', () => ({
  createAuthClient: vi.fn(() => ({
    signUp: {
      email: vi.fn(),
    },
    signIn: {
      email: vi.fn(),
    },
    signOut: vi.fn(),
    getSession: vi.fn(),
  })),
}));

describe('AuthStore', () => {
  let authStore: AuthStore;
  let mockUserStore: UserStore;
  let mockAuthClient: any;

  beforeEach(() => {
    vi.clearAllMocks();
    container.clearInstances();

    mockUserStore = {
      currentUser: null,
      setCurrentUser: vi.fn(),
    } as any;

    container.register(UserStore, { useValue: mockUserStore });

    authStore = container.resolve(AuthStore);
    mockAuthClient = (authStore as any).client;
  });

  describe('signUpEmail', () => {
    it('should sign up user and set current user', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
      };

      mockAuthClient.signUp.email.mockResolvedValue({
        data: { user: mockUser },
        error: null,
      });

      const params = {
        email: 'test@example.com',
        password: 'password123',
        name: 'Test User',
      };

      const result = await authStore.signUpEmail(params);

      expect(mockAuthClient.signUp.email).toHaveBeenCalledWith(params);
      expect(mockUserStore.setCurrentUser).toHaveBeenCalledWith(mockUser);
      expect(result.data?.user).toBe(mockUser);
    });

    it('should handle sign up without user data', async () => {
      mockAuthClient.signUp.email.mockResolvedValue({
        data: null,
        error: { message: 'Email already exists' },
      });

      const params = {
        email: 'test@example.com',
        password: 'password123',
        name: 'Test User',
      };

      const result = await authStore.signUpEmail(params);

      expect(mockAuthClient.signUp.email).toHaveBeenCalledWith(params);
      expect(mockUserStore.setCurrentUser).not.toHaveBeenCalled();
      expect(result.error).toBeDefined();
    });
  });

  describe('signInEmail', () => {
    it('should sign in user and set current user', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
      };

      mockAuthClient.signIn.email.mockResolvedValue({
        data: { user: mockUser },
        error: null,
      });

      const params = {
        email: 'test@example.com',
        password: 'password123',
      };

      const result = await authStore.signInEmail(params);

      expect(mockAuthClient.signIn.email).toHaveBeenCalledWith(params);
      expect(mockUserStore.setCurrentUser).toHaveBeenCalledWith(mockUser);
      expect(result.data?.user).toBe(mockUser);
    });

    it('should handle sign in failure', async () => {
      mockAuthClient.signIn.email.mockResolvedValue({
        data: null,
        error: { message: 'Invalid credentials' },
      });

      const params = {
        email: 'test@example.com',
        password: 'wrongpassword',
      };

      const result = await authStore.signInEmail(params);

      expect(mockAuthClient.signIn.email).toHaveBeenCalledWith(params);
      expect(mockUserStore.setCurrentUser).not.toHaveBeenCalled();
      expect(result.error).toBeDefined();
    });
  });

  describe('signOut', () => {
    it('should sign out and clear current user', async () => {
      mockAuthClient.signOut.mockResolvedValue({
        data: { success: true },
        error: null,
      });

      const params = {};
      const result = await authStore.signOut(params);

      expect(mockAuthClient.signOut).toHaveBeenCalledWith(params);
      expect(mockUserStore.setCurrentUser).toHaveBeenCalledWith(null);
      expect(result.data?.success).toBe(true);
    });

    it('should clear user even on sign out error', async () => {
      mockAuthClient.signOut.mockResolvedValue({
        data: null,
        error: { message: 'Sign out failed' },
      });

      const params = {};
      await authStore.signOut(params);

      expect(mockUserStore.setCurrentUser).toHaveBeenCalledWith(null);
    });
  });

  describe('getSession', () => {
    it('should get session and set current user', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
      };

      mockAuthClient.getSession.mockResolvedValue({
        data: { user: mockUser },
        error: null,
      });

      const result = await authStore.getSession();

      expect(mockAuthClient.getSession).toHaveBeenCalledWith({});
      expect(mockUserStore.setCurrentUser).toHaveBeenCalledWith(mockUser);
      expect(result.data?.user).toBe(mockUser);
    });

    it('should clear user when session is invalid', async () => {
      mockAuthClient.getSession.mockResolvedValue({
        data: null,
        error: { message: 'No session' },
      });

      await authStore.getSession();

      expect(mockUserStore.setCurrentUser).toHaveBeenCalledWith(null);
    });

    it('should accept custom params', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
      };

      mockAuthClient.getSession.mockResolvedValue({
        data: { user: mockUser },
        error: null,
      });

      const params = { fetchOptions: { cache: 'no-cache' } };
      await authStore.getSession(params as any);

      expect(mockAuthClient.getSession).toHaveBeenCalledWith(params);
    });

    it('should handle session without user', async () => {
      mockAuthClient.getSession.mockResolvedValue({
        data: { session: null },
        error: null,
      });

      await authStore.getSession();

      expect(mockUserStore.setCurrentUser).toHaveBeenCalledWith(null);
    });
  });
});
