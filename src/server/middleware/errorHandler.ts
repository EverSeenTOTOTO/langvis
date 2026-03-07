import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

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
    res.status(500).json({ error: err.message });
    return;
  }
  next();
};

export default errorHandler;
