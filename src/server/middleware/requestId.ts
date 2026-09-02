import { Express } from 'express';
import { context, trace, SpanStatusCode } from '@opentelemetry/api';
import { container } from 'tsyringe';
import { generateId } from '@/shared/utils';
import { AuthService } from '@/server/libs/infrastructure/auth.service';
import Logger from '../utils/logger';
import { isProd } from '../utils/env';
import { TraceContext } from '@/server/middleware/trace-context';
import { meter, tracer } from '../otel';

// Bun 下 instrumentation-http patch 不到（ESM 加载 express），http.server.request.duration
// 在 res finish 手动记录——沿用 semconv 名/单位/属性，OpenObserve 图表无缝续流。
const httpDuration = meter.createHistogram('http.server.request.duration', {
  unit: 's',
  advice: {
    explicitBucketBoundaries: [
      0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
    ],
  },
});

// prod 落日志的 header 白名单——剔除 cookie/authorization 等凭据；dev 保留全量便于调试。
const SAFE_HEADERS = ['user-agent', 'content-type', 'accept', 'x-request-id'];

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id?: string;
      log: typeof Logger;
    }
  }
}

export default async (app: Express) => {
  app.use(async (req, res, next) => {
    const existingID = req.id ?? req.headers['x-request-id'];
    const requestId = existingID ? (existingID as string) : generateId('req');
    req.id = requestId;

    const loggerMeta: Record<string, string> = { requestId };

    // Try to get sessionId if available
    const authService = container.resolve<AuthService>(AuthService);
    const sessionId = await authService.getSessionId(req).catch(() => null);
    if (sessionId) {
      loggerMeta.sessionId = sessionId;
    }

    req.log = Logger.child(loggerMeta);
    res.setHeader('X-Request-Id', requestId);

    // Bun 的 http builtin 不被 OTel http instrumentation patch——手动起 request span，
    // 下游在 span 上下文里跑：日志绑 trace_id、pg/db span 成子 span（修 Bun 无 server span 断链）。
    const startedAt = performance.now();
    const span = tracer.startSpan(`HTTP ${req.method} ${req.originalUrl}`, {
      attributes: {
        'http.method': req.method,
        'http.url': req.originalUrl,
        'http.target': req.originalUrl,
        'request.id': requestId,
      },
    });
    const spanCtx = trace.setSpan(context.active(), span);

    res.on('finish', () => {
      httpDuration.record((performance.now() - startedAt) / 1000, {
        'http.request.method': req.method,
        'http.response.status_code': res.statusCode,
      });
      span.setAttribute('http.status_code', res.statusCode);
      if (res.statusCode >= 500) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: res.statusMessage,
        });
      }
      span.end();
    });

    context.with(spanCtx, () => TraceContext.run({ requestId }, next));
  });

  app.use('/api/*', (req, res, next) => {
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
      headers,
    });

    res.on('finish', () => {
      req.log.info(`<- ${res.statusCode} ${req.method} ${req.originalUrl}`, {
        type: '<-',
        method: req.method,
        url: req.originalUrl,
        statusCode: res.statusCode,
        statusMessage: res.statusMessage,
      });
    });

    next();
  });
};
