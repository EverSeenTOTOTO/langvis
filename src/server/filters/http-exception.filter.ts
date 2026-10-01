import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import type { Response } from 'express';
import { ValidationException } from '@/shared/dto/base';
import { ExceptionBase } from '@/server/shared/exceptions/exception.base';
import { isProd } from '@/server/utils/env';
import type { Request } from 'express';

// Nest 全局异常过滤器：ValidationException→400、ExceptionBase→其 statusCode、
// HttpException 原样、未知→500（prod 泛指）。领域异常在领域抛，HTTP 映射只住这一处。
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { log?: typeof console }>();

    if (exception instanceof ValidationException) {
      req.log?.warn?.('Validation error:', exception.toJSON());
      res.status(400).json({
        error: 'Validation failed',
        details: exception.toJSON().errors,
      });
      return;
    }

    if (exception instanceof ExceptionBase) {
      req.log?.warn?.(`${exception.code}: ${exception.message}`);
      res
        .status(exception.statusCode)
        .json({ error: exception.message, code: exception.code });
      return;
    }

    if (exception instanceof HttpException) {
      res.status(exception.getStatus()).json(exception.getResponse() as object);
      return;
    }

    const e = exception as Error;
    req.log?.error?.(e?.stack || e?.message);
    res.status(500).json({
      error: isProd
        ? 'Internal Server Error'
        : e?.message || 'Internal Server Error',
    });
  }
}
