import { isProd } from '@/server/utils';
import bodyParser from 'body-parser';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import express, { Express } from 'express';
import path from 'node:path';
import 'reflect-metadata';
import bindControllers from './controller';
import bindAuthMiddleware from './middleware/auth';
import bindRequestId from './middleware/requestId';
import bindSSRMiddleware from './middleware/ssr';
import logger from './utils/logger';

logger.info(
  `Starting with environment: ${isProd ? 'production' : 'development'}`,
);

dotenv.config({
  path: isProd
    ? path.join(process.cwd(), '.env')
    : path.join(process.cwd(), '.env.development'),
  override: true,
});

export const createServer = async (): Promise<Express> => {
  const app = express();
  const dist = path.join(process.cwd(), 'dist');

  app.use(express.static(dist, { index: false }));
  app.use(bodyParser.urlencoded({ extended: false }));
  app.use(bodyParser.json());
  app.use(cookieParser());
  app.use(compression());

  await bindRequestId(app);
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
  .catch(logger.error);
