import { __dirname, isProd } from '@/server/utils';
import bodyParser from 'body-parser';
import compression from 'compression';
import dotenv from 'dotenv';
import express, { Express } from 'express';
import path from 'path';
import 'reflect-metadata';
import bindControllers from './controller';
import bindSessionMiddleware from './middleware/session';
import bindSSRMiddleware from './middleware/ssr';
import cookieParser from 'cookie-parser';

dotenv.config({
  path: isProd
    ? path.join(__dirname, '../.env')
    : path.join(__dirname, '../../.env.development'),
});

// hypothesis: client assets to be in the same directory
export const createServer = async (): Promise<Express> => {
  const app = express();

  app.use(express.static(__dirname, { index: false }));
  app.use(bodyParser.urlencoded({ extended: false }));
  app.use(bodyParser.json());

  app.use(cookieParser());
  app.use(compression());
  // TODO
  app.locals.logger = console;

  await bindSessionMiddleware(app);

  await bindControllers(app);
  // must be last
  await bindSSRMiddleware(app);

  return app;
};

const port = process.env.VITE_PORT || 3000;

createServer()
  .then(server => {
    server.listen(port, () => {
      server.locals.logger.info(`Server started at http://localhost:${port}`);
    });
  })
  .catch(console.error);
