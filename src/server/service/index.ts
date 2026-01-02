import { InjectTokens } from '@/shared/constants';
import type { Express } from 'express';
import { container } from 'tsyringe';
import { DataSource } from 'typeorm';
import logger from '../utils/logger';
import openai from './openai';
import pg from './pg';
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
