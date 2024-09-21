import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import express, { Express } from 'express';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({
  path:
    process.env.NODE_ENV === 'production'
      ? path.join(__dirname, '../../.env')
      : path.join(__dirname, '../../.env.development'),
});

// hypothesis: client assets to be in the same directory
export const createServer = async (): Promise<Express> => {
  const server = express();

  server.use(
    express.static(__dirname, {
      index: false,
    }),
  );

  server.get(/^\/api\//, (_, res) => {
    res.send('react and vite!');
  });

  if (process.env.NODE_ENV !== 'development') {
    const [{ render }, template] = await Promise.all([
      import(path.join(__dirname, 'index.server.js')),
      fs.promises.readFile(path.join(__dirname, 'index.html'), 'utf-8'),
    ]);

    server.get('*', async (req, res) => {
      const { html } = await render({ req, res, template });

      res.setHeader('Content-Type', 'text/html');
      res.end(html);
    });
  }

  return server;
};

const port = process.env.PORT || 3000;

createServer()
  .then(server => {
    server.listen(port, () => {
      console.log(`Server listening on port ${port}`);
    });
  })
  .catch(console.error);
