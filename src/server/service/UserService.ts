import { User, UserEntity } from '@/shared/entities/User';
import { inject } from 'tsyringe';
import { service } from '../decorator/service';
import { DatabaseService } from './DatabaseService';

@service()
export class UserService {
  constructor(@inject(DatabaseService) private readonly db: DatabaseService) {}

  async getAllUsers(): Promise<User[]> {
    const userRepository = this.db.getRepository(UserEntity);
    const users = await userRepository.find();
    return users;
  }

  async getUserById(id: string): Promise<User | null> {
    const userRepository = this.db.getRepository(UserEntity);
    const user = await userRepository.findOneBy({ id });
    return user;
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const userRepository = this.db.getRepository(UserEntity);
    const user = await userRepository.findOneBy({ email });
    return user;
  }
}
