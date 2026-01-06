import { InjectTokens } from '@/shared/constants';
import type { Express } from 'express';
import { container } from 'tsyringe';
import { DataSource } from 'typeorm';
import logger from '../utils/logger';
import initOpenAI, { OpenAI } from './openai';
import pg from './pg';
// import redis from './redis';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default async (_app: Express) => {
  if (!pg.isInitialized) {
    const start = Date.now();
    logger.info('Initializing PostgreSQL connection...');
    await pg.initialize();
    logger.info(`PostgreSQL connected in ${Date.now() - start}ms.`);
  }

  // lazy evaluation since env variables is not loaded when import
  const openai = initOpenAI();
  logger.info(
    `Initialize openai with api base: ${process.env.OPENAI_API_BASE}`,
  );

  container.register<OpenAI>(InjectTokens.OPENAI, {
    useValue: openai,
  });
  container.register<DataSource>(InjectTokens.PG, { useValue: pg });
  // container.register<typeof redis>(InjectTokens.REDIS, { useValue: redis });
};
