import { createServer as createViteServer } from 'vite';
import { __dirname, isProd } from '@/server/utils';
import { Express } from 'express';
import fs from 'fs';
import path from 'path';

// ssr
export default async (app: Express) => {
  if (!isProd) {
    const vite = await createViteServer({
      configFile: path.join(__dirname, '../../config/vite.common.ts'),
      server: { middlewareMode: true },
      appType: 'custom',
    });
    app.use(vite.middlewares);
    app.get('*', async (req, res, next) => {
      try {
        const templateHtml = await fs.promises.readFile(
          path.join(__dirname, '../../index.html'),
          'utf-8',
        );
        const { render } = await vite.ssrLoadModule(
          path.join(__dirname, '../client/index.server.tsx'),
        );
        const template = await vite.transformIndexHtml(
          req.originalUrl!,
          templateHtml,
        );
        const { html } = await render({ req, res, template });

        res.end(html);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        req.log.error(e);
        next();
      }
    });

    return;
  }

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
