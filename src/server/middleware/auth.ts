import { Express, Request, Response, NextFunction } from 'express';
import { container } from 'tsyringe';
import { AuthService } from '../service/AuthService';
import { TraceContext } from '../core/TraceContext';

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
  const authService = container.resolve<AuthService>(AuthService);

  app.use('/api', async (req: Request, res: Response, next: NextFunction) => {
    if (EXEMPT_PATH_PREFIXES.some(prefix => req.path.startsWith(prefix))) {
      return next();
    }

    try {
      const isAuthenticated = await authService.isAuthenticated(req);

      if (isAuthenticated) {
        const user = await authService.getUser(req);
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
