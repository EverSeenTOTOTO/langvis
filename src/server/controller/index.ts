import bindController from '@/server/decorator/controller';
import type { Express } from 'express';
import { container } from 'tsyringe';
import { DataSource } from 'typeorm';
import pg from '../service/pg';
// import redis from '../service/redis';
import { InjectTokens } from '../utils';
import { AuthController } from './AuthController';
import { UserController } from './UserController';

export default async (app: Express) => {
  if (!pg.isInitialized) {
    await pg.initialize();
  }

  // if (!redis.isReady) {
  //   await redis.connect();
  // }

  container.register<DataSource>(InjectTokens.PG, { useValue: pg });
  // container.register<typeof redis>(InjectTokens.REDIS, {
  //   useValue: redis,
  // });

  bindController(AuthController, app);
  bindController(UserController, app);
};
