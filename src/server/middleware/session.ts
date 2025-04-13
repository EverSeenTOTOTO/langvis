import { Express } from 'express';
import { v4 as uuid } from 'uuid';
import redis from '../service/redis';

export default async (app: Express) => {
  app.use(async (req, res, next) => {
    try {
      let token = req.cookies?.token || '';

      if (!token) {
        token = uuid();

        await redis.hSet(token, 'valid', 'true');
        await redis.expire(token, 3600);
      } else {
        const isValid = await redis.hGet(token, 'valid');

        if (!isValid) {
          res.status(401).json({ error: 'Unauthorized' });
          return;
        }
      }

      res.cookie('token', token, { httpOnly: true });
      next();
    } catch (error) {
      console.error('Session middleware error:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });
};

