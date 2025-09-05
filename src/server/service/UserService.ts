import { singleton } from 'tsyringe';
import pg from './pg';
import { UserEntity, User } from '@/shared/entities/User';

@singleton()
export class UserService {
  async getAllUsers(): Promise<User[]> {
    const userRepository = pg.getRepository(UserEntity);
    const users = await userRepository.find();
    return users;
  }

  async getUserById(id: string): Promise<User | null> {
    const userRepository = pg.getRepository(UserEntity);
    const user = await userRepository.findOneBy({ id });
    return user;
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const userRepository = pg.getRepository(UserEntity);
    const user = await userRepository.findOneBy({ email });
    return user;
  }
}
