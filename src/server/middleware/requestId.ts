import { Express, Request } from 'express';
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

export const mountRequestId = (app: Express, authService: AuthService) => {
  app.use(async (req, res, next) => {
    const existingID = req.id ?? req.headers['x-request-id'];
    const requestId = existingID ? (existingID as string) : generateId('req');
    req.id = requestId;

    const loggerMeta: Record<string, string> = { requestId };

    // Try to get sessionId if available
    const sessionId = await authService
      .getSessionId(req.headers.cookie ?? '')
      .catch(() => null);
    if (sessionId) {
      loggerMeta.sessionId = sessionId;
    }

    req.log = Logger.child(loggerMeta);
    res.setHeader('X-Request-Id', requestId);

    // server span / http 指标 / 日志 trace 关联均由 tracing.ts 的官方插桩接管
    //（HttpInstrumentation 的 span 在此处已 active，TraceContext 顺流而下）。
    TraceContext.run({ requestId }, next);
  });

  app.use('/api', (req, res, next) => {
    // prod 白名单 headers（不落 cookie/authorization）；dev 全量保留。
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
  });
};
