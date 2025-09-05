import type { Request, Response } from 'express';
import { inject, singleton } from 'tsyringe';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { AuthService } from '../service/AuthService';

@singleton()
@controller('/api/auth')
export class AuthController {
  constructor(@inject(AuthService) private auth?: AuthService) {}

  @api('/sign-in/email', { method: 'post' })
  async signIn(req: Request, res: Response) {
    const { headers, response } = await this.auth!.api.signInEmail({
      returnHeaders: true,
      body: req.body,
    });

    res.set('set-cookie', headers.getSetCookie());
    return res.json(response);
  }

  @api('/sign-up/email', { method: 'post' })
  async signUp(req: Request, res: Response) {
    const { headers, response } = await this.auth!.api.signUpEmail({
      returnHeaders: true,
      body: req.body,
    });

    res.set('set-cookie', headers.getSetCookie());
    return res.json(response);
  }

  @api('/sign-out', { method: 'post' })
  async signOut(req: Request, res: Response) {
    const response: any = await this.auth!.api.signOut({
      headers: {
        cookie: req.headers.cookie || '',
      },
    });

    // Clear the session cookie
    res.set('set-cookie', response.headers?.getSetCookie());
    return res.json({ success: true });
  }
}

