import { Express } from 'express';
import { randomUUID } from 'node:crypto';
import winston from 'winston';
import { isProd } from '../utils';
import 'winston-daily-rotate-file';
import chalk from 'chalk';
import { container } from 'tsyringe';
import { AuthService } from '../service/AuthService';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id?: string;
      log: winston.Logger;
    }
  }
}

const { combine, timestamp, printf, errors } = winston.format;

// Define colors for different log levels
const levelColors: Record<string, typeof chalk.red> = {
  error: chalk.red,
  warn: chalk.yellow,
  info: chalk.green,
  debug: chalk.blue,
};

const consoleFormat = printf(({ timestamp, level, message, ...meta }) => {
  const colorize = levelColors[level as string] || chalk.white;

  let base = `[${chalk.gray(timestamp)}] [${colorize(level.toUpperCase())}] ${message}`;

  if (meta && Object.keys(meta).length) {
    base += ' ' + chalk.cyan(JSON.stringify(meta));
  }

  return base;
});

const dailyRotate = new winston.transports.DailyRotateFile({
  filename: 'logs/langvis-%DATE%.log',
  datePattern: 'YYYY-MM-DD-HH',
  zippedArchive: true,
  maxSize: '20m',
  maxFiles: '14d',
});
const dailyRotateError = new winston.transports.DailyRotateFile({
  level: 'error',
  filename: 'logs/langvis-error-%DATE%.log',
  datePattern: 'YYYY-MM-DD-HH',
  zippedArchive: true,
  maxSize: '20m',
  maxFiles: '14d',
});

export const logger = winston.createLogger({
  level: isProd ? 'info' : 'debug',
  format: combine(
    errors({ stack: true }),
    timestamp({
      format: 'YYYY-MM-DD HH:mm:ss',
    }),
    consoleFormat,
  ),
  transports: [dailyRotate, dailyRotateError],
});

if (!isProd) {
  logger.add(
    new winston.transports.Console({
      level: 'debug',
    }),
  );
}

export default async (app: Express) => {
  app.use(async (req, res, next) => {
    const existingID = req.id ?? req.headers['x-request-id'];

    if (existingID) {
      req.id = existingID as string;
      return next();
    }

    const id = randomUUID();
    req.id = id;

    const loggerMeta: Record<string, string> = { requestId: id };

    // Try to get sessionId if available
    const authService = container.resolve<AuthService>(AuthService);
    const sessionId = await authService.getSessionId(req).catch(() => null);
    if (sessionId) {
      loggerMeta.sessionId = sessionId;
    }

    req.log = logger.child(loggerMeta);
    res.setHeader('X-Request-Id', id);
    next();
  });

  app.use('/api/*', (req, res, next) => {
    req.log.info({
      message: '->',
      method: req.method,
      url: req.originalUrl,
      headers: req.headers,
    });

    next();

    req.log.info({
      message: '<-',
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      statusMessage: res.statusMessage,
    });
  });
};
