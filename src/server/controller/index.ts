import bindController from '@/server/decorator/controller';
import type { Express } from 'express';
import pg from '../service/pg';
import redis from '../service/redis';
import { EdgeController } from './EdgeController';
import { GraphController } from './GraphController';
import { NodeController } from './NodeController';
import { NodeMetaController } from './NodeMetaController';
import { container, delay } from 'tsyringe';
import { DataSource } from 'typeorm';
import { SSEController } from './SSEController';
import { AuthController } from './AuthController';
import { ExecuteController } from './ExecuteController';
import { InjectTokens } from '../utils';
import { NodeService } from '../service/NodeService';
import { EdgeService } from '../service/EdgeService';

export default async (app: Express) => {
  if (!pg.isInitialized) {
    await pg.initialize();
  }

  if (!redis.isReady) {
    await redis.connect();
  }

  container.register<DataSource>(InjectTokens.PG, { useValue: pg });
  container.register<typeof redis>(InjectTokens.REDIS, {
    useValue: redis,
  });
  container.register<NodeService>(InjectTokens.NODE_SERVICE, {
    useToken: delay(() => NodeService),
  });
  container.register<EdgeService>(InjectTokens.EDGE_SERVICE, {
    useToken: delay(() => EdgeService),
  });

  bindController(AuthController, app);
  bindController(GraphController, app);
  bindController(NodeController, app);
  bindController(NodeMetaController, app);
  bindController(EdgeController, app);
  bindController(SSEController, app);
  bindController(ExecuteController, app);
};
