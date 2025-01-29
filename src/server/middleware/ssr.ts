import { __dirname, isProd } from '@/server/utils';
import { Express } from 'express';
import fs from 'fs';
import path from 'path';

export default async (app: Express) => {
  if (!isProd) {
    app.locals.logger.warn(
      `Client assets are served with vite dev server in ${process.env.NODE_ENV} mode.`,
    );
    return;
  }

  // ssr
  const [{ render }, template] = await Promise.all([
    import(path.join(__dirname, 'index.server.js')),
    fs.promises.readFile(path.join(__dirname, 'index.html'), 'utf-8'),
  ]);

  app.get('*', async (req, res) => {
    const { html } = await render({ req, res, template });

    res.setHeader('Content-Type', 'text/html');
    res.end(html);
  });
};
