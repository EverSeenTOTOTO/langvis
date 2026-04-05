import { typeormAdapter } from '@hedystia/better-auth-typeorm';
import { betterAuth } from 'better-auth';
import type { Request } from 'express';
import { service } from '../decorator/service';
import { getSessionHeaders } from '../utils';
import pg from './pg';

@service()
export class AuthService {
  private readonly auth = betterAuth({
    // @ts-expect-error type
    database: typeormAdapter(pg),
    emailAndPassword: {
      enabled: true,
    },
  });

  get api() {
    return this.auth.api;
  }

  protected getSessionData(req: Request) {
    const headers = getSessionHeaders(req);

    return this.auth.api.getSession({
      headers,
    });
  }

  async getSession(req: Request) {
    const data = await this.getSessionData(req);
    return data?.session;
  }

  async getSessionId(req: Request) {
    const id = (await this.getSession(req))?.token;

    if (!id) throw new Error('Invalid session');

    return id;
  }

  async getUser(req: Request) {
    const data = await this.getSessionData(req);
    return data?.user;
  }

  async getUserId(req: Request) {
    const id = (await this.getUser(req))?.id;

    if (!id) throw new Error('Invalid user');

    return id;
  }

  async isAuthenticated(req: Request): Promise<boolean> {
    try {
      const user = await this.getUser(req);
      return !!user;
    } catch {
      return false;
    }
  }
}
