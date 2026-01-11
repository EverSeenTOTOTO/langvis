import type { Response } from 'express';
import { inject } from 'tsyringe';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { param, response } from '../decorator/param';
import { UserService } from '../service/UserService';

@controller('/api/users')
export default class UserController {
  constructor(@inject(UserService) private userService: UserService) {}

  @api('/', { method: 'get' })
  async getAllUsers(@response() res: Response) {
    const users = await this.userService.getAllUsers();
    return res.json(users);
  }

  @api('/:id', { method: 'get' })
  async getUserById(@param('id') id: string, @response() res: Response) {
    const user = await this.userService.getUserById(id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json(user);
  }

  @api('/email/:email', { method: 'get' })
  async getUserByEmail(
    @param('email') email: string,
    @response() res: Response,
  ) {
    const user = await this.userService.getUserByEmail(email);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json(user);
  }
}
