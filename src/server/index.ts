import { __dirname, isProd } from '@/server/utils';
import bodyParser from 'body-parser';
import compression from 'compression';
import dotenv from 'dotenv';
import express, { Express } from 'express';
import path from 'path';
import bindGraphController from './controller/graph';
import bindLoggerMiddleware from './middleware/logger';
import bindSSRMiddleware from './middleware/ssr';

dotenv.config({
  path: isProd
    ? path.join(__dirname, '../../.env')
    : path.join(__dirname, '../../.env.development'),
});

// hypothesis: client assets to be in the same directory
export const createServer = async (): Promise<Express> => {
  const app = express();

  await bindLoggerMiddleware(app);
  await bindSSRMiddleware(app);

  app.use(express.static(__dirname, { index: false }));
  app.use(bodyParser.urlencoded({ extended: false }));
  app.use(bodyParser.json());
  app.use(compression());

  await bindGraphController(app);

  return app;
};

const port = process.env.PORT || 3000;

createServer()
  .then(server => {
    server.listen(port, () => {
      server.locals.logger.info(`server started at http://localhost:${port}`);
    });
  })
  .catch(console.error);
