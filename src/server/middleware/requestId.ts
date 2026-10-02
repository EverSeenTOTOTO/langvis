import { Request, Response, NextFunction } from 'express';
import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import { generateId } from '@/shared/utils';
import { AuthService } from '@/server/modules/user/infrastructure/auth.service';
import Logger from '../utils/logger';
import { isProd } from '../utils/env';
import { TraceContext } from '@/server/trace-context';

// prod 落日志的 header 白名单——剔除 cookie/authorization 等凭据；dev 保留全量便于调试。
const SAFE_HEADERS = ['user-agent', 'content-type', 'accept', 'x-request-id'];

// 客户端 IP（直连无代理场景）；剥掉 IPv6 映射前缀，供访问日志与 fail2ban 消费。
const clientIp = (req: Request) => req.ip?.replace('::ffff:', '');

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id?: string;
      log: typeof Logger;
    }
  }
}

/** 请求上下文装配：req.id / req.log / X-Request-Id 头（API 与 SSR 共用）。 */
async function applyRequestContext(
  req: Request,
  res: Response,
  authService: AuthService,
): Promise<string> {
  const existingID = req.id ?? req.headers['x-request-id'];
  const requestId = existingID ? (existingID as string) : generateId('req');
  req.id = requestId;

  const loggerMeta: Record<string, string> = { requestId };
  const sessionId = await authService
    .getSessionId(req.headers.cookie ?? '')
    .catch(() => null);
  if (sessionId) {
    loggerMeta.sessionId = sessionId;
  }
  req.log = Logger.child(loggerMeta);
  res.setHeader('X-Request-Id', requestId);
  return requestId;
}

/** SSR 侧请求上下文中间件（post-init 路由不经 Nest middleware，单独套用）。 */
export const ssrRequestContext =
  (authService: AuthService) =>
  async (req: Request, res: Response, next: NextFunction) => {
    const requestId = await applyRequestContext(req, res, authService);
    // server span / http 指标 / 日志 trace 关联均由 tracing.ts 的官方插桩接管
    //（HttpInstrumentation 的 span 在此处已 active，TraceContext 顺流而下）。
    TraceContext.run({ requestId }, next);
  };

/** /api 访问日志：进出各一条（prod header 白名单，不落凭据）。 */
function accessLog(req: Request, res: Response, next: NextFunction): void {
  const headers = isProd
    ? Object.fromEntries(
        SAFE_HEADERS.filter(k => req.headers[k] != null).map(k => [
          k,
          req.headers[k],
        ]),
      )
    : req.headers;

  req.log.info(`-> ${req.method} ${req.originalUrl}`, {
    type: '->',
    method: req.method,
    url: req.originalUrl,
    ip: clientIp(req),
    headers,
  });

  res.on('finish', () => {
    req.log.info(`<- ${res.statusCode} ${req.method} ${req.originalUrl}`, {
      type: '<-',
      method: req.method,
      url: req.originalUrl,
      ip: clientIp(req),
      statusCode: res.statusCode,
      statusMessage: res.statusMessage,
    });
  });

  next();
}

/** Nest 全局中间件：请求上下文 + 访问日志（覆盖全部 /api 路由，含 auth 透传）。 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const requestId = await applyRequestContext(req, res, this.authService);
    TraceContext.run({ requestId }, () => accessLog(req, res, next));
  }
}
