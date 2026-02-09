import { describe, it, expect, beforeEach } from 'vitest';
import { container } from 'tsyringe';
import { UserStore } from '@/client/store/modules/user';
import type { User } from '@/shared/types/entities';

describe('UserStore', () => {
  let userStore: UserStore;

  beforeEach(() => {
    container.clearInstances();
    userStore = container.resolve(UserStore);
  });

  describe('initialization', () => {
    it('should initialize with null currentUser', () => {
      expect(userStore.currentUser).toBeNull();
    });
  });

  describe('setCurrentUser', () => {
    it('should set current user', () => {
      const mockUser: User = {
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      userStore.setCurrentUser(mockUser);

      expect(userStore.currentUser).toEqual(mockUser);
      expect(userStore.currentUser?.id).toBe('user-123');
      expect(userStore.currentUser?.email).toBe('test@example.com');
    });

    it('should update current user', () => {
      const user1: User = {
        id: 'user-1',
        email: 'user1@example.com',
        name: 'User 1',
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const user2: User = {
        id: 'user-2',
        email: 'user2@example.com',
        name: 'User 2',
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      userStore.setCurrentUser(user1);
      expect(userStore.currentUser?.id).toBe('user-1');

      userStore.setCurrentUser(user2);
      expect(userStore.currentUser?.id).toBe('user-2');
    });

    it('should clear current user', () => {
      const mockUser: User = {
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      userStore.setCurrentUser(mockUser);
      expect(userStore.currentUser).not.toBeNull();

      userStore.setCurrentUser(null);
      expect(userStore.currentUser).toBeNull();
    });
  });
});
