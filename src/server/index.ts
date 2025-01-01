import { __dirname, isProd } from '@/server/utils';
import bodyParser from 'body-parser';
import compression from 'compression';
import dotenv from 'dotenv';
import express, { Express } from 'express';
import path from 'path';
import bindSSRMiddleware from './middleware/ssr';
import { ButtonNode } from './core/nodes/Button';

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
  app.use(compression());

  app.get('/api/test', (_req, res) => {
    const a = new ButtonNode({
      id: 'btn-1',
      position: { x: 0, y: 0 },
      data: {
        text: 'hello',
        layout: 'horizontal',
      },
    });
    const b = new ButtonNode({
      id: 'btn-2',
      position: { x: 100, y: 0 },
      data: {
        text: 'world',
        layout: 'vertical',
      },
    });

    res.end(JSON.stringify([a.toClient(), b.toClient()]));
  });

  // TODO
  app.locals.logger = console;
  // must be last
  await bindSSRMiddleware(app);

  return app;
};

const port = process.env.VITE_PORT || 3000;

createServer()
  .then(server => {
    server.listen(port, () => {
      server.locals.logger.info(`server started at http://localhost:${port}`);
    });
  })
  .catch(console.error);
