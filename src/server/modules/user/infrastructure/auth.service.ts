import { typeormAdapter } from '@hedystia/better-auth-typeorm';
import { betterAuth } from 'better-auth';
import { DatabaseService } from '@/server/infrastructure/database/database.service';
import { Inject } from '@nestjs/common';
import type { AuthPort } from '@/server/modules/user/domain/port/auth.port';

export class AuthService implements AuthPort {
  private auth: ReturnType<typeof betterAuth> | null = null;

  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {
    this.auth = betterAuth({
      database: typeormAdapter(this.db.dataSource),
      emailAndPassword: {
        enabled: true,
      },
      trustHost: true,
    });
  }

  get api() {
    return this.auth!.api;
  }

  /** 标准挂载用：/api/auth 下的完整 HTTP handler（自管 cookie）。 */
  get handler() {
    return this.auth!.handler;
  }

  protected async getSessionData(cookie: string) {
    const headers = new Headers();
    if (cookie) headers.set('cookie', cookie);
    return this.auth!.api.getSession({ headers });
  }

  async getSession(cookie: string) {
    const data = await this.getSessionData(cookie);
    return data?.session;
  }

  async getSessionId(cookie: string) {
    const id = (await this.getSession(cookie))?.token;

    if (!id) throw new Error('Invalid session');

    return id;
  }

  async getUser(cookie: string) {
    const data = await this.getSessionData(cookie);
    return data?.user;
  }

  async getUserId(cookie: string) {
    const id = (await this.getUser(cookie))?.id;

    if (!id) throw new Error('Invalid user');

    return id;
  }

  async isAuthenticated(cookie: string): Promise<boolean> {
    try {
      const user = await this.getUser(cookie);
      return !!user;
    } catch {
      return false;
    }
  }
}
