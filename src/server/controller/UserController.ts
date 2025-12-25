import type { Request, Response } from 'express';
import { inject } from 'tsyringe';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { UserService } from '../service/UserService';

@controller('/api/users')
export default class UserController {
  constructor(@inject(UserService) private userService: UserService) {}

  @api('/', { method: 'get' })
  async getAllUsers(_req: Request, res: Response) {
    const users = await this.userService.getAllUsers();
    return res.json(users);
  }

  @api('/:id', { method: 'get' })
  async getUserById(req: Request, res: Response) {
    const { id } = req.params;
    const user = await this.userService.getUserById(id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json(user);
  }

  @api('/email/:email', { method: 'get' })
  async getUserByEmail(req: Request, res: Response) {
    const { email } = req.params;
    const user = await this.userService.getUserByEmail(email);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json(user);
  }
}
