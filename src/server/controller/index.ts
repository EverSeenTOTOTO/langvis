import bindController from '@/server/decorator/controller';
import type { Express } from 'express';
import pg, { pgInjectToken } from '../service/pg';
import redis, { redisInjectToken } from '../service/redis';
import { EdgeController } from './EdgeController';
import { GraphController } from './GraphController';
import { NodeController } from './NodeController';
import { NodeMetaController } from './NodemetaController';
import { container } from 'tsyringe';
import { DataSource } from 'typeorm';
import { SSEController } from './SSEController';
import { AuthController } from './AuthController';

export default async (app: Express) => {
  container.register<DataSource>(pgInjectToken, { useValue: pg });
  container.register<typeof redis>(redisInjectToken, { useValue: redis });

  bindController(AuthController, app);
  bindController(GraphController, app);
  bindController(NodeController, app);
  bindController(NodeMetaController, app);
  bindController(EdgeController, app);
  bindController(SSEController, app);
};
