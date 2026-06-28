import { isProd } from '@/server/utils';
import bodyParser from 'body-parser';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import express, { Express } from 'express';
import path from 'node:path';
import 'reflect-metadata';
import bindControllers from './controller';
import './modules/memory/memory.module';
import './modules/agent/agent.module';
import './modules/conversation/conversation.module';
import './modules/document/document.module';
import './modules/email/email.module';
import './modules/settings/settings.module';
import './modules/user/user.module';
import { disposeAll } from './decorator/disposal';
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
  .then(app => {
    const server = app.listen(port, () => {
      logger.info(`Server started at http://localhost:${port}`);
    });

    const shutdown = () => {
      logger.info('Shutting down server...');

      disposeAll()
        .then(() => {
          server.closeAllConnections();
          server.close(() => {
            logger.info('Server shut down');
            process.exit(0);
          });
        })
        .catch(err => {
          logger.error('Error during shutdown:', err);
          server.closeAllConnections();
          server.close(() => process.exit(1));
        });

      setTimeout(() => {
        logger.warn('Forcing exit after timeout');
        process.exit(1);
      }, 5000).unref();
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  })
  .catch(logger.error);
