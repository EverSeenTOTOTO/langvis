import { __dirname, isProd } from '@/server/utils';
import bodyParser from 'body-parser';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import express, { Express } from 'express';
import path from 'node:path';
import 'reflect-metadata';
import bindControllers from './controller';
import bindAuthMiddleware from './middleware/auth';
import bindLogger, { logger } from './middleware/logger';
import bindSSRMiddleware from './middleware/ssr';

dotenv.config({
  path: isProd
    ? path.join(__dirname(), '../.env')
    : path.join(__dirname(), '../../.env.development'),
});

// hypothesis: client assets to be in the same directory
export const createServer = async (): Promise<Express> => {
  const app = express();

  app.use(express.static(__dirname(), { index: false }));
  app.use(bodyParser.urlencoded({ extended: false }));
  app.use(bodyParser.json());
  app.use(cookieParser());
  app.use(compression());

  await bindLogger(app);
  await bindAuthMiddleware(app);
  await bindControllers(app);
  // must be last
  await bindSSRMiddleware(app);
  return app;
};

const port = process.env.PORT || 3000;

createServer()
  .then(server => {
    server.listen(port, () => {
      logger.info(`Server started at http://localhost:${port}`);
    });
  })
  .catch(console.error);
