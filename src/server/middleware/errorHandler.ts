import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';
import { isProd } from '../utils/env';

const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (err) {
    logger.error(`Express error: ${err.message}`, {
      path: req.path,
      method: req.method,
    });
    // prod 回泛指消息，底层（SQL/路径）详情只进服务端日志；dev 保留 err.message 便于调试。
    res
      .status(500)
      .json({ error: isProd ? 'Internal Server Error' : err.message });
    return;
  }
  next();
};

export default errorHandler;
