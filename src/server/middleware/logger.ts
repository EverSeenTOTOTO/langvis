import express, { Express } from 'express';
import winston from 'winston';
import 'winston-daily-rotate-file';
import { isProd } from '@/server/utils';

const { format } = winston;

export const logger = winston.createLogger({
  level: 'info',
  format: format.combine(
    format.colorize(),
    format.timestamp(),
    format.printf(info => `${info.timestamp} [${info.level}]: ${info.message}`),
  ),
  transports: isProd
    ? [
        new winston.transports.DailyRotateFile({
          level: 'info',
          filename: 'langvis-%DATE%.log',
          datePattern: 'YYYY-MM-DD-HH',
          zippedArchive: true,
          maxSize: '20m',
          maxFiles: '14d',
        }),
        new winston.transports.DailyRotateFile({
          level: 'error',
          filename: 'langvis-error-%DATE%.log',
          datePattern: 'YYYY-MM-DD-HH',
          zippedArchive: true,
          maxSize: '20m',
          maxFiles: '14d',
        }),
      ]
    : [new winston.transports.Console()],
});

export default async (app: Express) => {
  app.locals.logger = logger;
  app.use((req, _res, next) => {
    logger.info(`${req.method} -> ${req.url}`);
    next();
    logger.info(`${req.method} <- ${req.url}`);
  });

  // dev log
  if (!isProd) {
    logger.warn(`start in ${process.env.NODE_ENV} mode`);
  }
};
