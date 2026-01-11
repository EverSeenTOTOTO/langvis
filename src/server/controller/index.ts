import bindController from '@/server/decorator/controller';
import chalk from 'chalk';
import type { Express } from 'express';
import { globby } from 'globby';
import path from 'path';
import setupServices from '../service';
import { isProd } from '../utils';
import logger from '../utils/logger';

export default async (app: Express) => {
  await setupServices(app);

  const suffix = isProd ? '.js' : '.ts';
  const pattern = `./${isProd ? 'dist' : 'src'}/server/controller/*Controller${suffix}`;

  const controllerPaths = await globby(pattern, {
    cwd: process.cwd(),
    absolute: true,
  });

  for (const absolutePath of controllerPaths) {
    const { default: controller } = await import(absolutePath);

    logger.info(
      `Binding controller: ${chalk.cyan(path.basename(absolutePath, suffix))}`,
    );

    bindController(controller, app);
  }
};
