import { randomUUID } from 'node:crypto';
import pino from 'pino-http';
import { isProd } from '../utils';

const middleware = pino({
  genReqId: (req, res) => {
    const existingID = req.id ?? req.headers['x-request-id'];

    if (existingID) return existingID;

    const id = randomUUID();
    req.id = id;
    res.setHeader('X-Request-Id', id);
    return id;
  },
  useLevel: isProd ? 'info' : 'debug',
  transport: {
    target: 'pino-pretty',
  },
});

const logger: Pick<Console, 'info' | 'debug' | 'warn' | 'error'> =
  middleware.logger;

export { logger };

export default middleware;
