import { Express, Request, Response, NextFunction } from 'express';
import { container } from 'tsyringe';
import { AUTH_PORT } from '@/server/modules/user/user.di-tokens';
import type { AuthPort } from '@/server/modules/user/domain/port/auth.port';
import { TraceContext } from '@/server/middleware/trace-context';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: any;
    }
  }
}

const EXEMPT_PATH_PREFIXES = [
  '/auth/sign-up/email',
  '/auth/sign-in/email',
  '/auth/get-session',
  '/emails/inbound',
  '/files/play/',
  '/files/download/',
];

export default async (app: Express) => {
  const authPort = container.resolve<AuthPort>(AUTH_PORT);

  app.use('/api', async (req: Request, res: Response, next: NextFunction) => {
    if (EXEMPT_PATH_PREFIXES.some(prefix => req.path.startsWith(prefix))) {
      return next();
    }

    try {
      const isAuthenticated = await authPort.isAuthenticated(req);

      if (isAuthenticated) {
        const user = await authPort.getUser(req);
        req.user = user;

        // Update TraceContext with userId
        if (user?.id) {
          TraceContext.update({ userId: user.id });
        }

        next();
      } else {
        res.status(401).json({
          error: 'Unauthorized',
          redirect: '/login',
          message: 'Authentication required',
        });
      }
    } catch (e) {
      res.status(401).json({
        error: 'Unauthorized',
        redirect: '/login',
        message: `Check Authentication failed: ${(e as Error).message}`,
      });
    }
  });
};
