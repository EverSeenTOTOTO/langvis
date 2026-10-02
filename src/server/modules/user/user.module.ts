import { Module } from '@nestjs/common';
import { USER_REPOSITORY } from './user.di-tokens';
import { UserRepository } from './infrastructure/persistence/user.repository';
import { UserService } from './application/user.service';
import { UserController } from './user.controller';
import { ModelsController } from './models.controller';
import { AuthProxyController } from './auth-proxy.controller';

@Module({
  controllers: [UserController, ModelsController, AuthProxyController],
  providers: [
    UserService,
    { provide: USER_REPOSITORY, useClass: UserRepository },
  ],
})
export class UserModule {}
