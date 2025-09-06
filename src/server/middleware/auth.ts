import { Express, Request, Response, NextFunction } from 'express';
import { container } from 'tsyringe';
import { AuthService } from '../service/AuthService';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: any;
    }
  }
}

const EXEMPT_PATHS = [
  '/auth/sign-up/email',
  '/auth/sign-in/email',
  '/auth/get-session',
];

export default async (app: Express) => {
  const authService = container.resolve<AuthService>(AuthService);

  app.use('/api', async (req: Request, res: Response, next: NextFunction) => {
    if (EXEMPT_PATHS.includes(req.path)) {
      return next();
    }

    try {
      const isAuthenticated = await authService.isAuthenticated(req);

      if (isAuthenticated) {
        const user = await authService.getUser(req);
        req.user = user;
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
