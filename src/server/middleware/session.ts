import session from 'cookie-session';
import { Express } from 'express';
import { v4 as uuid } from 'uuid';

export default async (app: Express) => {
  app.use(
    session({
      name: 'session',
      keys: [process.env.VITE_SESSION_SECRET!],
      maxAge: 24 * 60 * 60 * 1000,
      signed: false, // TODO
    }),
  );

  app.use((req, _res, next) => {
    if (req.session && !req.session?.id) {
      req.session.id = uuid();
    }

    next();
  });
};
