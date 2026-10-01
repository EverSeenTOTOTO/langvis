import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AUTH_PORT } from '@/server/modules/user/user.di-tokens';
import type { AuthPort } from '@/server/modules/user/domain/port/auth.port';
import { TraceContext } from '@/server/middleware/trace-context';

export const IS_PUBLIC_KEY = 'isPublic';
/** 标记免鉴权端点（inbound webhook、公开媒体流）。 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: any;
    }
  }
}

/** 全局鉴权 guard：session 校验 + req.user 注入 + TraceContext userId。 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AUTH_PORT) private readonly authPort: AuthPort,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context
      .switchToHttp()
      .getRequest<
        Request & { user?: any; log?: { warn?: (m: string) => void } }
      >();
    const cookie = req.headers.cookie ?? '';

    try {
      const isAuthenticated = await this.authPort.isAuthenticated(cookie);
      if (!isAuthenticated) {
        throw new UnauthorizedException({
          error: 'Unauthorized',
          redirect: '/login',
          message: 'Authentication required',
        });
      }
      const user = await this.authPort.getUser(cookie);
      req.user = user;
      if (user?.id) {
        TraceContext.update({ userId: user.id });
      }
      return true;
    } catch (e) {
      if (e instanceof UnauthorizedException) throw e;
      throw new UnauthorizedException({
        error: 'Unauthorized',
        redirect: '/login',
        message: `Check Authentication failed: ${(e as Error).message}`,
      });
    }
  }
}
