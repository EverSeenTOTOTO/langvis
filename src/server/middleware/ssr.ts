import { isProd } from '@/server/utils/env';
import { Express, Request } from 'express';
import fs from 'fs';
import path from 'path';
import { container } from 'tsyringe';
import { createServer as createViteServer } from 'vite';
import { AuthService } from '@/server/libs/infrastructure/auth.service';
import { isEmpty } from 'lodash-es';

const configFile = path.join(process.cwd(), `config/vite.common.ts`);
const templateFile = path.join(
  process.cwd(),
  `${isProd ? 'dist/' : ''}index.html`,
);
const serverEntry = path.join(
  process.cwd(),
  isProd ? 'dist/index.server.js' : 'src/client/index.server.tsx',
);

// SSR bundle 与 server bundle 模块态隔离——session 在此处（server bundle）进程内解析，
// 经 RenderContext.user 传给 SSR 入口，避免其经 HTTP 自往返取 /api/auth/get-session。
async function resolveUser(req: Request) {
  if (isEmpty(req.cookies)) return null;
  const authService = container.resolve(AuthService);
  return authService.getUser(req).catch(e => {
    req.log.error(e);
    return null;
  });
}

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
        const user = await resolveUser(req);
        const { html } = await render({ req, res, template, user });

        res.setHeader('Content-Type', 'text/html');
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
    const user = await resolveUser(req);
    const { html } = await render({ req, res, template, user });

    res.setHeader('Content-Type', 'text/html');
    res.end(html);
  });
};
