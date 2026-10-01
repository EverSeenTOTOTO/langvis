import { isProd } from '@/server/utils/env';
import { Express, Request, Response } from 'express';
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

// 只对已知页面路由做 SSR——公网扫描器探针（.php / wp-admin 等）直接 404，
// 省一次完整 React 渲染；404 亦可供 fail2ban 计数。新增页面记得同步此表。
const SSR_ROUTES = new Set([
  '/',
  '/login',
  '/documents',
  '/emails',
  '/files',
  '/notfound',
]);

const isSsrRoute = (url: string) =>
  SSR_ROUTES.has(url.split('?')[0].replace(/\/+$/, '') || '/');

// 非 /api 路径不过访问日志中间件——探针 404 在此落一条带 IP 的日志（fail2ban 原料）。
function rejectProbe(req: Request, res: Response) {
  req.log.info(`404 ${req.method} ${req.originalUrl}`, {
    type: '404',
    method: req.method,
    url: req.originalUrl,
    ip: req.ip?.replace('::ffff:', ''),
  });
  res.status(404).end('Not Found');
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
    app.get('/{*splat}', async (req, res, next) => {
      if (!isSsrRoute(req.originalUrl!)) {
        rejectProbe(req, res);
        return;
      }
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

  app.get('/{*splat}', async (req, res) => {
    if (!isSsrRoute(req.originalUrl!)) {
      rejectProbe(req, res);
      return;
    }
    const user = await resolveUser(req);
    const { html } = await render({ req, res, template, user });

    res.setHeader('Content-Type', 'text/html');
    res.end(html);
  });
};
