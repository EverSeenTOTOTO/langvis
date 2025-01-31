import bindController from '@/server/decorator/controller';
import type { Express } from 'express';
import pg from '../service/pg';
import { GraphController } from './graph';
import { NodeController } from './node';
import { NodeMetaController } from './nodemeta';

export default async (app: Express) => {
  if (!pg.isInitialized) {
    await pg.initialize();
  }

  const pool = { pg };

  bindController(GraphController, app, pool);
  bindController(NodeController, app, pool);
  bindController(NodeMetaController, app, pool);
};
