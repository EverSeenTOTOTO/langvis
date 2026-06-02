import type { User } from '@/shared/entities/User';

export interface UserRepositoryPort {
  findAll(): Promise<User[]>;

  findById(id: string): Promise<User | null>;

  findByEmail(email: string): Promise<User | null>;
}
