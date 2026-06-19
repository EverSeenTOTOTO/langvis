import { container, Lifecycle } from 'tsyringe';
import { USER_REPOSITORY, AUTH_PORT } from './user.di-tokens';
import { UserRepository } from './infrastructure/persistence/user.repository';
import { AuthService } from '@/server/libs/infrastructure/auth.service';

container.register(USER_REPOSITORY, UserRepository, {
  lifecycle: Lifecycle.Singleton,
});

container.register(AUTH_PORT, AuthService);
