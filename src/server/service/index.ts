import { container } from 'tsyringe';
import pg from './pg';
import type { Express } from 'express';
import openai from './openai';
import { InjectTokens } from '@/shared/constants';
import { DataSource } from 'typeorm';
import { logger } from '../middleware/logger';
// import redis from './redis';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default async (_app: Express) => {
  const start = performance.now();
  if (!pg.isInitialized) {
    logger.info('Initializing PostgreSQL connection...');
    await pg.initialize();
    logger.info(`PostgreSQL connected in ${performance.now() - start}ms.`);
  }

  container.register<typeof openai>(InjectTokens.OPENAI, { useValue: openai });
  container.register<DataSource>(InjectTokens.PG, { useValue: pg });
  // container.register<typeof redis>(InjectTokens.REDIS, { useValue: redis });
};
