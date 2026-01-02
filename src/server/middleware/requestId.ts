import { Express } from 'express';
import { container } from 'tsyringe';
import { v4 as uuidv4 } from 'uuid';
import { AuthService } from '../service/AuthService';
import Logger from '../utils/logger';

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

    if (existingID) {
      req.id = existingID as string;
      return next();
    }

    const id = uuidv4();
    req.id = id;

    const loggerMeta: Record<string, string> = { requestId: id };

    // Try to get sessionId if available
    const authService = container.resolve<AuthService>(AuthService);
    const sessionId = await authService.getSessionId(req).catch(() => null);
    if (sessionId) {
      loggerMeta.sessionId = sessionId;
    }

    req.log = Logger.child(loggerMeta);
    res.setHeader('X-Request-Id', id);
    next();
  });

  app.use('/api/*', (req, res, next) => {
    req.log.info({
      type: '->',
      method: req.method,
      url: req.originalUrl,
      headers: req.headers,
    });

    next();

    req.log.info({
      type: '<-',
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      statusMessage: res.statusMessage,
    });
  });
};
