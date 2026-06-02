import type { User } from '@/shared/entities/User';
import { inject } from 'tsyringe';
import { service } from '@/server/decorator/service';
import { USER_REPOSITORY } from './user.di-tokens';
import type { UserRepositoryPort } from './database/user.repository.port';

@service()
export class UserService {
  constructor(
    @inject(USER_REPOSITORY)
    private readonly repo: UserRepositoryPort,
  ) {}

  async getAllUsers(): Promise<User[]> {
    return this.repo.findAll();
  }

  async getUserById(id: string): Promise<User | null> {
    return this.repo.findById(id);
  }

  async getUserByEmail(email: string): Promise<User | null> {
    return this.repo.findByEmail(email);
  }
}
