import { describe, it, beforeEach, afterEach, vi, expect } from 'vitest';
import { HttpException } from '@nestjs/common';
import { UserController } from '@/server/modules/user/user.controller';

const mockUserService = {
  getAllUsers: vi.fn(),
  getUserById: vi.fn(),
  getUserByEmail: vi.fn(),
};

const expectHttpError = async (
  promise: Promise<unknown>,
  status: number,
  body: Record<string, unknown>,
) => {
  const err = (await promise.catch(e => e)) as HttpException;
  expect(err).toBeInstanceOf(HttpException);
  expect(err.getStatus()).toBe(status);
  expect(err.getResponse()).toMatchObject(body);
};

describe('UserController', () => {
  let controller: UserController;

  beforeEach(() => {
    controller = new UserController(mockUserService as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('getAllUsers 返回全量用户', async () => {
    const users = [{ id: 'u1', name: 'A' }];
    mockUserService.getAllUsers!.mockResolvedValue(users);
    await expect(controller.getAllUsers()).resolves.toBe(users);
  });

  it('getUserById 命中返回用户', async () => {
    const user = { id: 'u1', name: 'A' };
    mockUserService.getUserById!.mockResolvedValue(user);
    await expect(controller.getUserById('u1')).resolves.toBe(user);
    expect(mockUserService.getUserById).toHaveBeenCalledWith('u1');
  });

  it('getUserById 未命中抛 404', async () => {
    mockUserService.getUserById!.mockResolvedValue(null);
    await expectHttpError(controller.getUserById('nope'), 404, {
      error: 'User not found',
    });
  });

  it('getUserByEmail 命中返回用户', async () => {
    const user = { id: 'u1', email: 'a@b.c' };
    mockUserService.getUserByEmail!.mockResolvedValue(user);
    await expect(controller.getUserByEmail('a@b.c')).resolves.toBe(user);
  });

  it('getUserByEmail 未命中抛 404', async () => {
    mockUserService.getUserByEmail!.mockResolvedValue(null);
    await expectHttpError(controller.getUserByEmail('none@b.c'), 404, {
      error: 'User not found',
    });
  });
});
