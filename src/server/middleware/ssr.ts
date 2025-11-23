import { createServer as createViteServer } from 'vite';
import { __dirname, isProd } from '@/server/utils';
import { Express } from 'express';
import fs from 'fs';
import path from 'path';

const configFile = path.join(
  __dirname(),
  isProd ? `../../config/vite.common.ts` : `../../../config/vite.common.ts`,
);
const templateFile = path.join(
  __dirname(),
  isProd ? 'index.html' : '../../../index.html',
);
const serverEntry = path.join(
  __dirname(),
  isProd ? 'index.server.js' : '../../client/index.server.tsx',
);

// ssr
export default async (app: Express) => {
  if (!isProd) {
    const vite = await createViteServer({
      configFile: configFile,
      server: { middlewareMode: true },
      appType: 'custom',
    });
    app.use(vite.middlewares);
    app.get('*', async (req, res, next) => {
      try {
        const templateHtml = await fs.promises.readFile(templateFile, 'utf-8');
        const { render } = await vite.ssrLoadModule(serverEntry);
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
    import(serverEntry),
    fs.promises.readFile(templateFile, 'utf-8'),
  ]);

  app.get('*', async (req, res) => {
    const { html } = await render({ req, res, template });

    res.setHeader('Content-Type', 'text/html');
    res.end(html);
  });
};
