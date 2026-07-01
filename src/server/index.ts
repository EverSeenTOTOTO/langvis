import { isProd } from '@/server/utils';
import bodyParser from 'body-parser';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import express, { Express } from 'express';
import type { Server } from 'http';
import path from 'node:path';
import 'reflect-metadata';
import bindControllers from './controller';
import './libs/compaction';
import './libs/infrastructure/llm.module';
import './modules/agent/agent.module';
import './modules/conversation/conversation.module';
import './modules/document/document.module';
import './modules/email/email.module';
import './modules/settings/settings.module';
import './modules/user/user.module';
import { bootAll, shutdownAll } from './decorator/lifecycle';
import bindAuthMiddleware from './middleware/auth';
import bindRequestId from './middleware/requestId';
import bindSSRMiddleware from './middleware/ssr';
import errorHandler from './middleware/errorHandler';
import logger from './utils/logger';

logger.info(
  `Starting with environment: ${isProd ? 'production' : 'development'}`,
);

dotenv.config({
  path: isProd
    ? path.join(process.cwd(), '.env')
    : path.join(process.cwd(), '.env.development'),
  override: true,
});

export const createServer = async (): Promise<Express> => {
  const app = express();
  const dist = path.join(process.cwd(), 'dist');

  app.use(express.static(dist, { index: false }));
  // 上传产物（如 TTS 合成的 upload/tts/*.mp3）静态服务，供前端按 /upload/... 直取。
  app.use('/upload', express.static(path.join(process.cwd(), 'upload')));
  app.use(bodyParser.urlencoded({ extended: false }));
  app.use(bodyParser.json({ limit: '10mb' }));
  app.use(cookieParser());
  app.use(compression());

  await bindRequestId(app);
  await bindAuthMiddleware(app);
  await bindControllers(app);
  // must be last
  await bindSSRMiddleware(app);
  app.use(errorHandler);
  return app;
};

const port = process.env.PORT || 3000;

createServer()
  .then(async app => {
    await bootAll(); // 生命周期启动钩子（DB 就绪 + 孤儿 run 清扫等）

    const server = app.listen(port, () =>
      logger.info(`Server started at http://localhost:${port}`),
    );

    const shutdown = () => {
      logger.info('Shutting down server...');
      shutdownAll()
        .then(() => gracefulClose(server, 0))
        .catch(err => {
          logger.error('Error during shutdown:', err);
          gracefulClose(server, 1);
        });
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  })
  .catch(logger.error);

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
