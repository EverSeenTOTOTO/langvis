import { Express } from 'express';
import { container } from 'tsyringe';
import { generateId } from '@/shared/utils';
import { AuthService } from '../service/AuthService';
import Logger from '../utils/logger';
import { TraceContext } from '../core/TraceContext';

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

    // Initialize TraceContext for this request
    // Must use async/await pattern to keep context across async boundaries
    TraceContext.run({ requestId }, () => next());
  });

  app.use('/api/*', (req, res, next) => {
    req.log.info({
      type: '->',
      method: req.method,
      url: req.originalUrl,
      headers: req.headers,
    });

    res.on('finish', () => {
      req.log.info({
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
