import { InjectTokens } from '@/shared/constants';
import type { Express } from 'express';
import { container } from 'tsyringe';
import { DataSource } from 'typeorm';
import logger from '../utils/logger';
import pg from './pg';

export default async (_app: Express) => {
  if (!pg.isInitialized) {
    const start = Date.now();
    logger.info('Initializing PostgreSQL connection...');
    await pg
      .initialize()
      .catch(err => console.error('Failed to initialize:', err));
    logger.info(`PostgreSQL connected in ${Date.now() - start}ms.`);
  }

  container.register<DataSource>(InjectTokens.PG, { useValue: pg });
};
