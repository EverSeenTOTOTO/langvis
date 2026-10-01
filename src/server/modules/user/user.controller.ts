import { Controller, Get, HttpException, Inject, Param } from '@nestjs/common';
import { UserService } from './application/user.service';

@Controller('users')
export class UserController {
  constructor(@Inject(UserService) private readonly userService: UserService) {}

  @Get()
  async getAllUsers() {
    return this.userService.getAllUsers();
  }

  @Get('email/:email')
  async getUserByEmail(@Param('email') email: string) {
    const user = await this.userService.getUserByEmail(email);
    if (!user) {
      throw new HttpException({ error: 'User not found' }, 404);
    }
    return user;
  }

  @Get(':id')
  async getUserById(@Param('id') id: string) {
    const user = await this.userService.getUserById(id);
    if (!user) {
      throw new HttpException({ error: 'User not found' }, 404);
    }
    return user;
  }
}
