import bindController from '@/server/decorator/controller';
import type { Express } from 'express';
import setupServices from '../service';
import { globby } from 'globby';
import { isProd } from '../utils';
import { logger } from '../middleware/logger';
import chalk from 'chalk';
import path from 'path';

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
      `Binding controller: ${chalk.blueBright(path.basename(absolutePath, suffix))}`,
    );

    bindController(controller, app);
  }
};
