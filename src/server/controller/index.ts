import bindController from '@/server/decorator/controller';
import type { Express } from 'express';
import pg from '../service/pg';
import { GraphController } from './graph';
import { NodeController } from './node';
import { NodeMetaController } from './nodemeta';
import { Graph } from '../core/graph';

export default async (app: Express) => {
  if (!pg.isInitialized) {
    await pg.initialize();
  }

  const pool = { pg, graphs: new Map<string, Graph>() };

  bindController(GraphController, app, pool);
  bindController(NodeController, app, pool);
  bindController(NodeMetaController, app, pool);
};
