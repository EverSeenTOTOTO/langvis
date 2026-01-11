import {
  SignInEmailRequestDto,
  SignUpEmailRequestDto,
} from '@/shared/dto/controller';
import type { Request, Response } from 'express';
import { inject } from 'tsyringe';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { body, request, response } from '../decorator/param';
import { AuthService } from '../service/AuthService';
import { getSessionHeaders } from '../utils';

@controller('/api/auth')
export default class AuthController {
  constructor(@inject(AuthService) private auth?: AuthService) {}

  @api('/sign-in/email', { method: 'post' })
  async signIn(@body() dto: SignInEmailRequestDto, @response() res: Response) {
    const { headers, response } = await this.auth!.api.signInEmail({
      returnHeaders: true,
      body: dto,
    });

    res.set('set-cookie', headers.getSetCookie());
    return res.json(response);
  }

  @api('/sign-up/email', { method: 'post' })
  async signUp(@body() dto: SignUpEmailRequestDto, @response() res: Response) {
    const { headers, response } = await this.auth!.api.signUpEmail({
      returnHeaders: true,
      body: dto,
    });

    res.set('set-cookie', headers.getSetCookie());
    return res.json(response);
  }

  @api('/sign-out', { method: 'post' })
  async signOut(@request() req: Request, @response() res: Response) {
    const response: any = await this.auth!.api.signOut({
      headers: {
        cookie: req.headers.cookie || '',
      },
    });

    res.set('set-cookie', response.headers?.getSetCookie());
    return res.json({ success: true });
  }

  @api('/get-session')
  async getSession(@request() req: Request, @response() res: Response) {
    const response: any = await this.auth!.api.getSession({
      headers: getSessionHeaders(req),
    });
    return res.json(response);
  }
}
