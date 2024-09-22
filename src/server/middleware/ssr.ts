import path from 'path';
import fs from 'fs';
import { Express } from 'express';
import { __dirname, isProd } from '@/server/utils';

export default async (app: Express) => {
  if (!isProd) {
    app.locals.logger.warn(`ssr is disabled in ${process.env.NODE_ENV} mode`);
    return;
  }

  // ssr
  const [{ render }, template] = await Promise.all([
    import(path.join(__dirname, 'index.server.js')),
    fs.promises.readFile(path.join(__dirname, 'index.html'), 'utf-8'),
  ]);

  app.get('*', async (req, res) => {
    const start = Date.now();

    app.locals.logger.debug(`rendering ${req.url}`);

    const { html } = await render({ req, res, template });

    app.locals.logger.debug(`render cost ${req.url}: ${Date.now() - start}ms`);

    res.setHeader('Content-Type', 'text/html');
    res.end(html);
  });
};
