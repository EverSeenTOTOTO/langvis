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

// Paths that should skip authentication check
const EXEMPT_PATHS = ['/api/auth/sign-in/email', '/api/auth/sign-up/email'];

// Check if a path should be exempt from authentication
const isExemptPath = (path: string): boolean => {
  return EXEMPT_PATHS.some(
    exemptPath => path === exemptPath || path.startsWith(exemptPath + '/'),
  );
};

export default async (app: Express) => {
  const authService = container.resolve<AuthService>(AuthService);

  // Middleware to check if user is authenticated
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    // Skip authentication for exempt paths
    if (isExemptPath(req.path)) {
      return next();
    }

    try {
      // Check if user is authenticated
      const isAuthenticated = await authService.isAuthenticated(req);

      if (isAuthenticated) {
        // User is authenticated, try to get user data
        const user = await authService.getUser(req);
        req.user = user;
        next();
      } else {
        // For API routes, return JSON response
        if (req.path.startsWith('/api/')) {
          return res.status(401).json({
            error: 'Unauthorized',
            redirect: '/login',
            message: 'Authentication required',
          });
        }

        // For page routes in SPA apps, let the client handle authentication
        // by returning the base HTML template which will run the client-side routing
        next();
      }
    } catch {
      // Error occurred (e.g., invalid session)
      // For API routes, return JSON response
      if (req.path.startsWith('/api/')) {
        return res.status(401).json({
          error: 'Unauthorized',
          redirect: '/login',
          message: 'Authentication required',
        });
      }

      // For page routes in SPA apps, let the client handle authentication
      next();
    }
  });
};

