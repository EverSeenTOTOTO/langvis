import { Express } from 'express';
import { v4 as uuid } from 'uuid';
import redis from '../service/redis';

export default async (app: Express) => {
  app.use(async (req, res, next) => {
    try {
      const token = req.cookies?.token;

      if (!token) {
        const newToken = uuid();
        await redis.sendCommand(['SET', newToken, 'true', 'EX', '3600', 'NX']);
        res.cookie('token', newToken, { httpOnly: true });
      } else {
        const isValid = await redis.get(token);

        if (!isValid) {
          res.status(401).json({ error: 'Unauthorized' });
          return;
        }
      }

      next();
    } catch (error) {
      console.error('Session middleware error:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });
};
