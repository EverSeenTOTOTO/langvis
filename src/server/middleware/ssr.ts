import { isProd } from '@/server/utils/env';
import { Express, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { AuthService } from '@/server/shared/infrastructure/auth.service';
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
async function resolveUser(req: Request, authService: AuthService) {
  if (isEmpty(req.cookies)) return null;
  return authService.getUser(req.headers.cookie ?? '').catch(e => {
    req.log.error(e);
    return null;
  });
}

// history fallback：无扩展名的 GET 一律 SSR，client 路由自解析（未知路径渲染 NotFound 页）；
// 带扩展名的（.php 等探针、静态资源未命中）直接 404，日志供 fail2ban 计数。
const looksLikeProbe = (pathname: string) => /\.[a-zA-Z0-9]+$/.test(pathname);

const isSsrRoute = (url: string) => {
  const pathname = url.split('?')[0]!.replace(/\/+$/, '') || '/';
  return !looksLikeProbe(pathname);
};

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
export default async (app: Express, authService: AuthService) => {
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
        const user = await resolveUser(req, authService);
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
    const user = await resolveUser(req, authService);
    const { html } = await render({ req, res, template, user });

    res.setHeader('Content-Type', 'text/html');
    res.end(html);
  });
};
