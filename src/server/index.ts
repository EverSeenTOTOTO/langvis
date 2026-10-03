import './tracing';
import { isProd } from '@/server/utils/env';
import bodyParser from 'body-parser';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import express, { Express } from 'express';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import 'reflect-metadata';
import { initializeTransactionalContext } from 'typeorm-transactional';
import { AppModule } from './app.module';
import errorHandler from './middleware/errorHandler';
import logger from './utils/logger';
import { TerminalServer } from '@/server/terminal/terminal.server';
import { SsrMountService } from '@/server/middleware/ssr-mount.service';
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
}

// Nest 即根应用：全部路由经 globalPrefix 落 /api，auth 透传/SSR 等原组合根挂载
// 分别收编为 AuthProxyController（/api/auth/*）与 SsrMountService（post-init catch-all）。
export const createServer = async (): Promise<BootedApp> => {
  const nestApp = await NestFactory.create(AppModule, new ExpressAdapter(), {
    logger: false,
    abortOnError: false, // init 异常默认 process.abort() 无输出，关掉以便排障
    bodyParser: false, // 解析器自装（10mb limit），不用 Nest 默认 100kb
  });
  nestApp.setGlobalPrefix('api');

  const app = nestApp.getHttpAdapter().getInstance() as Express;

  // express 标准件（无 DI，注册序先于 Nest 路由）：静态资源 + 解析器。
  mountStatic(app);
  mountParsers(app);

  await nestApp.init();

  // post-init（注册序在全部 /api 路由之后）：SSR catch-all + 兜底 error middleware。
  await nestApp.get(SsrMountService, { strict: false }).mount(app);
  app.use(errorHandler);

  return { app, nestApp };
};

/** 静态资源：/assets immutable 长缓存（产物带内容 hash），dist 协商缓存，/upload 直取。 */
const mountStatic = (app: Express) => {
  const dist = path.join(process.cwd(), 'dist');
  app.use(
    '/assets',
    express.static(path.join(dist, 'assets'), {
      index: false,
      maxAge: '365d',
      immutable: true,
    }),
  );
  app.use(express.static(dist, { index: false }));
  app.use('/upload', express.static(path.join(process.cwd(), 'upload')));
};

/** 请求体/cookie 解析 + compression（SSE 心跳的 res.flush() 依赖它）。 */
const mountParsers = (app: Express) => {
  app.use(bodyParser.urlencoded({ extended: false }));
  app.use(bodyParser.json({ limit: '10mb' }));
  app.use(cookieParser());
  app.use(compression());
};

// ── 进程入口（tsx watch / node dist/server.js）────────────────────────────
// 被 e2e 测试 import 时不 listen、不挂信号钩子。
const isMainModule =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) void startMain();

async function startMain(): Promise<void> {
  const port = parseInt(process.env.PORT || '', 10);
  if (Number.isNaN(port)) {
    throw new Error(`Invalid port: ${port}`);
  }

  const { nestApp } = await createServer();
  const server = await nestApp.listen(port, () =>
    logger.info(`Server started at http://localhost:${port}`),
  );

  const terminal = nestApp.get(TerminalServer, { strict: false });
  terminal.attach(server); // 终端托管：浏览器 ⇄ ws ⇄ PTY ⇄ CLI（upgrade 事件挂载；cwd 默认 /tmp/langvis-workspace 随机目录）

  let shuttingDown = false;
  const shutdown = () => {
    // tsx watch 的 relaySignal 会向本进程再转发同一信号（ms 级重复投递）：
    // once 注册会让第二发落到无 handler 的进程上（默认行为=立即终止），必须吸收。
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Shutting down server...');
    // 5s 强退兜底覆盖整个关停链：nestApp.close() 会被 SSE/终端 WS 长连接
    // 卡住不 resolve（tsx watch 热重载因此失效——旧进程占端口，新进程 EADDRINUSE）。
    setTimeout(() => {
      logger.warn('Forcing exit after timeout');
      process.exit(1);
    }, 5000).unref();
    // 先停听再斩活跃连接：客户端断线自动重连会瞬间回连新 socket，
    // 只斩不停听则 nestApp.close() 内部的 server.close() 永远等不到连接排干。
    server.close();
    // 终端 ws 是 upgraded 连接，closeAllConnections 不追踪——不先终结它们，
    // nestApp.close() 的 dispose()（先于 shutdown 钩子）会永远等不排干，钩子全饿死。
    terminal.closeAll();
    server.closeAllConnections();
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
}

/** 关停收尾：关服务退出（连接已斩、强退兜底在 shutdown 入口）。 */
function gracefulClose(server: Server, code: number): void {
  server.close(() => {
    logger.info('Server shut down');
    process.exit(code);
  });
}
