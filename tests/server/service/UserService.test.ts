import { UserService } from '@/server/modules/user/domain/user.service';
import { beforeEach, afterEach, vi, describe, it, expect } from 'vitest';
import type { UserRepositoryPort } from '@/server/modules/user/database/user.repository.port';

const mockRepo = {
  findAll: vi.fn(),
  findById: vi.fn(),
  findByEmail: vi.fn(),
} as unknown as UserRepositoryPort;

describe('UserService', () => {
  let userService: UserService;

  beforeEach(() => {
    vi.clearAllMocks();
    userService = new UserService(mockRepo);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should get all users', async () => {
    const mockUsers = [
      {
        id: '1',
        name: 'John Doe',
        email: 'john@example.com',
        emailVerified: true,
        image: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: '2',
        name: 'Jane Smith',
        email: 'jane@example.com',
        emailVerified: false,
        image: 'https://example.com/image.jpg',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    vi.mocked(mockRepo.findAll).mockResolvedValue(mockUsers);

    const users = await userService.getAllUsers();

    expect(users).toEqual(mockUsers);
    expect(mockRepo.findAll).toHaveBeenCalled();
  });

  it('should get user by ID', async () => {
    const mockUser = {
      id: '1',
      name: 'John Doe',
      email: 'john@example.com',
      emailVerified: true,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.mocked(mockRepo.findById).mockResolvedValue(mockUser);

    const user = await userService.getUserById('1');

    expect(user).toEqual(mockUser);
    expect(mockRepo.findById).toHaveBeenCalledWith('1');
  });

  it('should return null when user is not found by ID', async () => {
    vi.mocked(mockRepo.findById).mockResolvedValue(null);

    const user = await userService.getUserById('nonexistent');

    expect(user).toBeNull();
    expect(mockRepo.findById).toHaveBeenCalledWith('nonexistent');
  });

  it('should get user by email', async () => {
    const mockUser = {
      id: '1',
      name: 'John Doe',
      email: 'john@example.com',
      emailVerified: true,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.mocked(mockRepo.findByEmail).mockResolvedValue(mockUser);

    const user = await userService.getUserByEmail('john@example.com');

    expect(user).toEqual(mockUser);
    expect(mockRepo.findByEmail).toHaveBeenCalledWith('john@example.com');
  });

  it('should return null when user is not found by email', async () => {
    vi.mocked(mockRepo.findByEmail).mockResolvedValue(null);

    const user = await userService.getUserByEmail('nonexistent@example.com');

    expect(user).toBeNull();
    expect(mockRepo.findByEmail).toHaveBeenCalledWith(
      'nonexistent@example.com',
    );
  });
});
