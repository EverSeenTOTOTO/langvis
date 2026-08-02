import { isTest } from '@/shared/utils';
import chalk from 'chalk';
import { isEmpty, isObject } from 'lodash-es';
import winston from 'winston';
import 'winston-daily-rotate-file';
import { isProd } from './env';
import { TraceContext } from '@/server/middleware/trace-context';

export type Logger = winston.Logger;

const { timestamp, printf } = winston.format;

const levelColors: Record<string, typeof chalk.red> = {
  error: chalk.red,
  warn: chalk.yellow,
  info: chalk.green,
  debug: chalk.blue,
};

const consoleFormat = printf(({ timestamp: time, level, ...meta }) => {
  const colorize = levelColors[level as string] || chalk.white;

  let result = `[${chalk.gray(time)}] [${colorize(level.toUpperCase())}]`;

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
  if (meta.conversationId) {
    result += ` ${chalk.gray(`[convId: ${meta.conversationId}]`)}`;
    delete meta.conversationId;
  }
  if (meta.runId) {
    result += ` ${chalk.gray(`[runId: ${meta.runId}]`)}`;
    delete meta.runId;
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

/** 生产文件 transport：单行 JSON（机器可解析/聚合）。dev 文件 + 控制台仍用 consoleFormat 人眼读。 */
const jsonFormat = printf(info => {
  const { timestamp: ts, level, message, ...rest } = info;
  return JSON.stringify({ timestamp: ts, level, message, ...rest });
});

const fileFormat = isProd ? jsonFormat : consoleFormat;

const logger = winston.createLogger({
  level: isProd ? 'info' : 'debug',
  format: timestamp({
    format: 'YYYY-MM-DD HH:mm:ss',
  }),
  transports: isTest()
    ? [new winston.transports.Console({ silent: true })]
    : [
        new winston.transports.DailyRotateFile({
          filename: 'logs/langvis-%DATE%.log',
          datePattern: 'YYYY-MM-DD-HH',
          zippedArchive: true,
          maxSize: '20m',
          maxFiles: '14d',
          format: fileFormat,
        }),
        new winston.transports.DailyRotateFile({
          level: 'error',
          filename: 'logs/langvis-error-%DATE%.log',
          datePattern: 'YYYY-MM-DD-HH',
          zippedArchive: true,
          maxSize: '20m',
          maxFiles: '14d',
          format: fileFormat,
        }),
      ],
});

if (!isProd) {
  logger.add(
    new winston.transports.Console({
      level: 'debug',
      format: consoleFormat,
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

    // Auto-inject trace context from TraceContext
    const trace = TraceContext.get();
    if (trace) {
      const traceMeta: Record<string, any> = {};
      if (trace.requestId) traceMeta.requestId = trace.requestId;
      if (trace.userId) traceMeta.userId = trace.userId;
      if (trace.runId) traceMeta.runId = trace.runId;
      if (trace.conversationId) traceMeta.conversationId = trace.conversationId;

      // Merge trace meta with first meta object if it exists
      if (safeMeta.length > 0 && typeof safeMeta[0] === 'object') {
        safeMeta[0] = { ...traceMeta, ...safeMeta[0] };
      } else {
        safeMeta.unshift(traceMeta);
      }
    }

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

// 原始 winston logger（未包装），仅用于需要 winston.Logger 类型签名的场景（如 LlmPort.chatContent）。
export const winstonLogger: Logger = logger;
