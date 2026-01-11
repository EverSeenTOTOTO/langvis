import { describe, it, beforeEach, afterEach, vi, expect } from 'vitest';
import UserController from '@/server/controller/UserController';
import { UserService } from '@/server/service/UserService';

// Create a proper mock for UserService
const mockUserService = {
  getAllUsers: vi.fn(),
  getUserById: vi.fn(),
  getUserByEmail: vi.fn(),
} as unknown as UserService;

const mockResponse = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

describe('UserController', () => {
  let userController: UserController;

  beforeEach(() => {
    // Create controller with mocked service
    userController = new UserController(mockUserService);
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
        image: '',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    vi.mocked(mockUserService.getAllUsers).mockResolvedValue(mockUsers);
    const res = mockResponse();

    await userController.getAllUsers(res);

    expect(res.json).toHaveBeenCalledWith(mockUsers);
  });

  it('should get user by ID', async () => {
    const mockUser = {
      id: '1',
      name: 'John Doe',
      email: 'john@example.com',
      emailVerified: true,
      image: '',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.mocked(mockUserService.getUserById).mockResolvedValue(mockUser);
    const res = mockResponse();

    await userController.getUserById('1', res);

    expect(res.json).toHaveBeenCalledWith(mockUser);
  });

  it('should return 404 when user is not found by ID', async () => {
    vi.mocked(mockUserService.getUserById).mockResolvedValue(null);
    const res = mockResponse();

    await userController.getUserById('nonexistent', res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'User not found' });
  });

  it('should get user by email', async () => {
    const mockUser = {
      id: '1',
      name: 'John Doe',
      email: 'john@example.com',
      emailVerified: true,
      image: '',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.mocked(mockUserService.getUserByEmail).mockResolvedValue(mockUser);
    const res = mockResponse();

    await userController.getUserByEmail('john@example.com', res);

    expect(res.json).toHaveBeenCalledWith(mockUser);
  });

  it('should return 404 when user is not found by email', async () => {
    vi.mocked(mockUserService.getUserByEmail).mockResolvedValue(null);
    const res = mockResponse();

    await userController.getUserByEmail('nonexistent@example.com', res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'User not found' });
  });
});
