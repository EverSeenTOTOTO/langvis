import { User, UserEntity } from '@/shared/entities/User';
import type { UserRepositoryPort } from '../../domain/port/user.repository.port';
import { DatabaseService } from '@/server/libs/infrastructure/database.service';
import { inject, singleton } from 'tsyringe';

@singleton()
export class UserRepository implements UserRepositoryPort {
  constructor(@inject(DatabaseService) private readonly db: DatabaseService) {}

  async findAll(): Promise<User[]> {
    const repo = this.db.getRepository(UserEntity);
    return repo.find();
  }

  async findById(id: string): Promise<User | null> {
    const repo = this.db.getRepository(UserEntity);
    return repo.findOneBy({ id });
  }

  async findByEmail(email: string): Promise<User | null> {
    const repo = this.db.getRepository(UserEntity);
    return repo.findOneBy({ email });
  }
}
