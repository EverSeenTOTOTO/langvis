import fs from 'fs';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { defineConfig, ViteDevServer } from 'vite';
import base, { paths } from './vite.common';

const devApiProxy = () => ({
  name: 'dev-api-proxy',
  configureServer(vite: ViteDevServer) {
    const { logger } = vite.config;
    const proxy = createProxyMiddleware({
      target: `http://localhost:${vite.config.env?.VITE_PORT}/api`,
      changeOrigin: true,
      logger,
    });

    vite.middlewares.use('/api', proxy);
  },
});

const templateHtml = fs.readFileSync(paths.template, 'utf-8');
const devSSR = () => ({
  name: 'dev-ssr',
  configureServer(vite: ViteDevServer) {
    const { logger } = vite.config;

    // 缺点是不能调试完整服务端代码，只能调试服务端同构应用的部分
    return () =>
      vite.middlewares.use(async (req, res, next) => {
        try {
          const { render } = await vite.ssrLoadModule(paths.serverEntry);
          const template = await vite.transformIndexHtml(
            req.originalUrl!,
            templateHtml,
          );
          const { html } = await render({ req, res, template });

          res.end(html);
        } catch (e) {
          vite.ssrFixStacktrace(e);
          logger.error(e.stack ?? e.message);
          next();
        }
      });
  },
});

export default defineConfig(c => {
  const config = base(c);
  return {
    ...config,
    server: {
      host: 'localhost',
    },
    ssr: {
      noExternal: ['tsyringe'],
    },
    plugins: [...(config.plugins || []), devApiProxy(), devSSR()],
  };
});
