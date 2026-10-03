import { typeormAdapter } from '@hedystia/better-auth-typeorm';
import { betterAuth } from 'better-auth';
import { DatabaseService } from '@/server/infrastructure/database/database.service';
import { Inject } from '@nestjs/common';
import type { AuthPort } from '@/server/modules/user/domain/port/auth.port';
import { TraceContext } from '@/server/trace-context';

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

  // 每请求会话校验记忆化：better-auth getSession 每次打 DB（隧道 RTT 可观），单请求链（中间件+Guard+Controller）同 cookie 校验 3-4 次。
  // 命中即免查；生命周期 = 请求（TraceContext ALS），登出/换号下一请求即刻生效；无请求上下文（WS/后台）直查。
  protected async getSessionData(
    cookie: string,
  ): Promise<{ session?: { token?: string }; user?: { id?: string } } | null> {
    const memo = TraceContext.get()?.authMemo;
    if (memo && memo.cookie === cookie) {
      return memo.data as {
        session?: { token?: string };
        user?: { id?: string };
      } | null;
    }
    const headers = new Headers();
    if (cookie) headers.set('cookie', cookie);
    const data = (await this.auth!.api.getSession({ headers })) as {
      session?: { token?: string };
      user?: { id?: string };
    } | null;
    // 无请求上下文（WS upgrade/后台事件）时 update 会抛——仅在有 store 时记忆
    if (TraceContext.get()) TraceContext.update({ authMemo: { cookie, data } });
    return data;
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
