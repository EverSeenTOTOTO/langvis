import { container, Lifecycle } from 'tsyringe';
import { USER_REPOSITORY } from './user.di-tokens';
import { UserRepository } from './database/user.repository';

container.register(USER_REPOSITORY, UserRepository, {
  lifecycle: Lifecycle.Singleton,
});
