import { typeormAdapter } from '@hedystia/better-auth-typeorm';
import { betterAuth } from 'better-auth';
import type { Request } from 'express';
import { singleton } from 'tsyringe';
import pg from './pg';
// import redis from './redis';

@singleton()
export class AuthService {
  readonly auth = betterAuth({
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    database: typeormAdapter(pg),
    // secondaryStorage: {
    //   get: async key => {
    //     const value = await redis.get(key);
    //     return value ?? null;
    //   },
    //   set: async (key, value, ttl) => {
    //     if (ttl) {
    //       await redis.set(key, value, { EX: ttl });
    //     } else {
    //       await redis.set(key, value);
    //     }
    //   },
    //   delete: async key => {
    //     await redis.del(key);
    //   },
    // },
    emailAndPassword: {
      enabled: true,
    },
  });

  get api() {
    return this.auth.api;
  }

  protected getSessionData(req: Request) {
    const headers = new Headers();

    // Copy the headers from the request
    for (const [key, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) {
        headers.append(key, value[0]);
      } else {
        headers.append(key, value!);
      }
    }

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
