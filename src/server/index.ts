import './tracing';
import { isProd } from '@/server/utils/env';
import bodyParser from 'body-parser';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import express, { Express } from 'express';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import type { Server } from 'http';
import type { INestApplication } from '@nestjs/common';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import 'reflect-metadata';
import { initializeTransactionalContext } from 'typeorm-transactional';
import { toNodeHandler } from 'better-auth/node';
import { AppModule } from './app.module';
import { AuthService } from './shared/infrastructure/auth.service';
import bindRequestId from './middleware/requestId';
import bindSSRMiddleware from './middleware/ssr';
import errorHandler from './middleware/errorHandler';
import logger from './utils/logger';
import { attachTerminalServer } from '@/server/terminal/terminal.server';
import { shutdownTracing } from './tracing';

logger.info(
  `Starting with environment: ${isProd ? 'production' : 'development'}`,
);

dotenv.config({
  path: isProd
    ? path.join(process.cwd(), '.env')
    : path.join(process.cwd(), '.env.development'),
  override: true,
});

// typeorm-transactional 原型补丁——须先于任何 DataSource 建立与事务执行。
initializeTransactionalContext();

export interface BootedApp {
  app: Express;
  nestApp: INestApplication;
  authService: AuthService;
}

// Nest-first 自举：先建 Nest（init 即跑生命周期），再装配 express 壳。
// 挂载序：requestId → better-auth → Nest(/api) → SSR（last）。
export const createServer = async (): Promise<BootedApp> => {
  const app = express();
  const dist = path.join(process.cwd(), 'dist');

  // vite 产物带内容 hash——/assets 可放心 immutable 长缓存（省掉每次刷新的
  // revalidate RTT）；其余（index.html 等）仍走默认协商缓存。
  app.use(
    '/assets',
    express.static(path.join(dist, 'assets'), {
      index: false,
      maxAge: '365d',
      immutable: true,
    }),
  );
  app.use(express.static(dist, { index: false }));
  // 上传产物（如 TTS 合成的 upload/tts/*.mp3）静态服务，供前端按 /upload/... 直取。
  app.use('/upload', express.static(path.join(process.cwd(), 'upload')));
  app.use(bodyParser.urlencoded({ extended: false }));
  app.use(bodyParser.json({ limit: '10mb' }));
  app.use(cookieParser());
  app.use(compression());

  const nestApp = await NestFactory.create(AppModule, new ExpressAdapter(), {
    logger: false,
    abortOnError: false, // init 异常默认 process.abort() 无输出，关掉以便排障
  });
  await nestApp.init();
  const authService = nestApp.get(AuthService, { strict: false });

  await bindRequestId(app, authService);
  // better-auth 标准挂载：完整 handler 自管 cookie，先于 Nest 子应用。
  app.use('/api/auth', toNodeHandler(authService.handler));
  // Nest 子应用挂 /api（SSR 之前）。Nest 会 404 终结子应用内未匹配请求，
  // 故不能挂根前缀（会截走 SSR catch-all 流量）。
  app.use('/api', nestApp.getHttpAdapter().getInstance());
  // must be last
  await bindSSRMiddleware(app, authService);
  app.use(errorHandler);
  return { app, nestApp, authService };
};

// 仅作为进程入口时自举（tsx watch / node dist/server.js）；
// 被 e2e 测试 import 时不 listen、不挂信号钩子。
const isMainModule =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  const port = parseInt(process.env.PORT || '', 10);

  if (Number.isNaN(port)) {
    throw new Error(`Invalid port: ${port}`);
  }

  createServer()
    .then(({ app, nestApp, authService }) => {
      const server = app.listen(port, () =>
        logger.info(`Server started at http://localhost:${port}`),
      );

      attachTerminalServer(server, authService); // 终端托管：浏览器 ⇄ ws ⇄ PTY ⇄ CLI（upgrade 事件挂载）

      const shutdown = () => {
        logger.info('Shutting down server...');
        // Nest 拥有全部实例：close() 触发 onApplicationShutdown（app 层先停、DB 池最后）
        nestApp
          .close()
          .then(() => shutdownTracing())
          .then(() => gracefulClose(server, 0))
          .catch((err: Error) => {
            logger.error('Error during shutdown:', err);
            gracefulClose(server, 1);
          });
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);

      // 进程级兜底：未 catch 的 rejection/exception 在 Node≥15 默认静默崩进程——
      // 此处记日志后硬退，使崩溃有痕可溯（状态已不确定，不走 graceful）。
      process.on('unhandledRejection', reason => {
        logger.error('Unhandled rejection:', reason);
        process.exit(1);
      });
      process.on('uncaughtException', err => {
        logger.error('Uncaught exception:', err);
        process.exit(1);
      });
    })
    .catch(logger.error);
}

/** 关停收尾：关连接 → 关服务 → 退出；5s 强制兜底。 */
function gracefulClose(server: Server, code: number): void {
  server.closeAllConnections();
  server.close(() => {
    logger.info('Server shut down');
    process.exit(code);
  });
  setTimeout(() => {
    logger.warn('Forcing exit after timeout');
    process.exit(1);
  }, 5000).unref();
}
