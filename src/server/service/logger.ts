import chalk from 'chalk';
import { isObject } from 'lodash-es';
import winston from 'winston';
import 'winston-daily-rotate-file';
import { isProd } from '../utils';

export type Logger = winston.Logger;

const { combine, timestamp, printf, errors } = winston.format;

const levelColors: Record<string, typeof chalk.red> = {
  error: chalk.red,
  warn: chalk.yellow,
  info: chalk.green,
  debug: chalk.blue,
};

const consoleFormat = printf(({ timestamp, level, ...meta }) => {
  const colorize = levelColors[level as string] || chalk.white;

  let result = `[${chalk.gray(timestamp)}] [${colorize(level.toUpperCase())}]`;

  if (!meta || Object.keys(meta).length === 0) {
    return result;
  }

  if (meta.source) {
    result += ` ${chalk.gray(chalk.bold(`[${meta.source}]`))}`;
    delete meta.source;
  }
  if (meta.requestId) {
    result += ` ${chalk.gray(`[rId: ${meta.requestId}]`)}`;
    delete meta.requestId;
  }
  if (meta.sessionId) {
    result += ` ${chalk.gray(`[sId: ${meta.sessionId}]`)}`;
    delete meta.sessionId;
  }
  if (meta.userId) {
    result += ` ${chalk.gray(`[uId: ${meta.userId}]`)}`;
    delete meta.userId;
  }

  if (isObject(meta.message)) {
    const extra = meta.message as Record<string, any>;
    if (extra.type) {
      result += ` ${extra.type}`;
      delete extra.type;
    }
    if (extra.method) {
      result += ` ${chalk.bold(extra.method)}`;
      delete extra.method;
    }
    if (extra.url) {
      result += ` ${chalk.italic(extra.url)}`;
      delete extra.url;
    }
    delete meta.message;
    meta = { ...meta, ...extra };
    result += ` ${chalk.cyan(JSON.stringify(meta))}`;
  } else {
    result += ` ${meta.message || ''}`;
  }

  return result;
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

const logger = winston.createLogger({
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

export default logger;
