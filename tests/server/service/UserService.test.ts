import { describe, it, beforeEach, afterEach, vi, expect } from 'vitest';
import { UserService } from '@/server/service/UserService';
import { DatabaseService } from '@/server/service/DatabaseService';

// Create a mock repository with the needed methods
const mockRepository = {
  find: vi.fn(),
  findOneBy: vi.fn(),
};

// Mock the DatabaseService module
vi.mock('@/server/service/DatabaseService', () => {
  return {
    DatabaseService: vi.fn().mockImplementation(() => ({
      getRepository: vi.fn(() => mockRepository),
    })),
  };
});

describe('UserService', () => {
  let userService: UserService;
  let mockDb: DatabaseService;

  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks();

    // Create a new instance
    mockDb = new DatabaseService();
    userService = new UserService(mockDb);
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

    mockRepository.find.mockResolvedValue(mockUsers);

    const users = await userService.getAllUsers();

    expect(users).toEqual(mockUsers);
    expect(mockRepository.find).toHaveBeenCalled();
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

    mockRepository.findOneBy.mockResolvedValue(mockUser);

    const user = await userService.getUserById('1');

    expect(user).toEqual(mockUser);
    expect(mockRepository.findOneBy).toHaveBeenCalledWith({ id: '1' });
  });

  it('should return null when user is not found by ID', async () => {
    mockRepository.findOneBy.mockResolvedValue(null);

    const user = await userService.getUserById('nonexistent');

    expect(user).toBeNull();
    expect(mockRepository.findOneBy).toHaveBeenCalledWith({
      id: 'nonexistent',
    });
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

    mockRepository.findOneBy.mockResolvedValue(mockUser);

    const user = await userService.getUserByEmail('john@example.com');

    expect(user).toEqual(mockUser);
    expect(mockRepository.findOneBy).toHaveBeenCalledWith({
      email: 'john@example.com',
    });
  });

  it('should return null when user is not found by email', async () => {
    mockRepository.findOneBy.mockResolvedValue(null);

    const user = await userService.getUserByEmail('nonexistent@example.com');

    expect(user).toBeNull();
    expect(mockRepository.findOneBy).toHaveBeenCalledWith({
      email: 'nonexistent@example.com',
    });
  });
});
