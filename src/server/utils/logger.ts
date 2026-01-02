import chalk from 'chalk';
import { isEmpty, isObject } from 'lodash-es';
import winston from 'winston';
import 'winston-daily-rotate-file';
import { isProd } from '.';

export type Logger = winston.Logger;

const { combine, timestamp, printf } = winston.format;

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
    const extra = { ...(meta.message as Record<string, any>) };
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
    const finalMeta = { ...meta, ...extra };
    result += ` ${chalk.cyan(JSON.stringify(finalMeta))}`;
  } else if (typeof meta.message === 'string') {
    const message = meta.message;
    delete meta.message;
    result += ` ${message || ''}`;
    if (!isEmpty(meta)) {
      result += ` ${chalk.cyan(JSON.stringify(meta))}`;
    }
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

// Safely serialize errors to avoid readonly property issues in Winston
const serializeError = (error: unknown): Record<string, any> => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      ...Object.getOwnPropertyNames(error).reduce(
        (acc, key) => {
          if (key !== 'name' && key !== 'message' && key !== 'stack') {
            try {
              acc[key] = (error as any)[key];
            } catch {
              // Ignore unreadable properties
            }
          }
          return acc;
        },
        {} as Record<string, any>,
      ),
    };
  }
  return error as Record<string, any>;
};

// Create a safe wrapper around Winston logger
const createSafeLogger = (winstonLogger: winston.Logger) => {
  const makeSafe = (value: any): any => {
    if (value instanceof Error) {
      return serializeError(value);
    }
    if (value && typeof value === 'object') {
      // Deep clone to ensure Winston can't modify readonly properties
      try {
        return JSON.parse(JSON.stringify(value));
      } catch {
        // Fallback for non-serializable objects
        return String(value);
      }
    }
    return value;
  };

  const safeLog = (level: string, message: any, ...meta: any[]) => {
    const safeMessage = makeSafe(message);
    const safeMeta = meta.map(makeSafe);
    return (winstonLogger as any)[level](safeMessage, ...safeMeta);
  };

  return {
    error: (message: any, ...meta: any[]) => safeLog('error', message, ...meta),
    warn: (message: any, ...meta: any[]) => safeLog('warn', message, ...meta),
    info: (message: any, ...meta: any[]) => safeLog('info', message, ...meta),
    debug: (message: any, ...meta: any[]) => safeLog('debug', message, ...meta),
    child: (options: any) => createSafeLogger(winstonLogger.child(options)),
  };
};

export default createSafeLogger(logger);
