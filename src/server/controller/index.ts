import bindController from '@/server/decorator/controller';
import type { Express } from 'express';
import { globby } from 'globby';
import setupServices from '../service';
import { isProd } from '../utils';

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

    bindController(controller, app);
  }
};
