import bindController from '@/server/decorator/controller';
import type { Express } from 'express';
import { container } from 'tsyringe';
import { DataSource } from 'typeorm';
import pg from '../service/pg';
import { GraphController } from './graph';
import { NodeController } from './node';
import { NodeMetaController } from './nodemeta';

export default async (app: Express) => {
  if (!pg.isInitialized) {
    await pg.initialize();
  }

  container.register<DataSource>(DataSource, { useValue: pg });

  bindController(GraphController, app);
  bindController(NodeController, app);
  bindController(NodeMetaController, app);
};
