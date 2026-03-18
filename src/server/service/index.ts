import { InjectTokens } from '@/shared/constants';
import chalk from 'chalk';
import type { Express } from 'express';
import { container } from 'tsyringe';
import { DataSource } from 'typeorm';
import logger from '../utils/logger';
import initOpenAI, { OpenAI } from './openai';
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

  const openai = initOpenAI();
  logger.info(
    `Initialize openai with api base: ${chalk.bgBlue(process.env.OPENAI_API_BASE)}, default model: ${chalk.bgRed(process.env.OPENAI_MODEL)}`,
  );

  container.register<OpenAI>(InjectTokens.OPENAI, {
    useValue: openai,
  });
  container.register<DataSource>(InjectTokens.PG, { useValue: pg });
};
