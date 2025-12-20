import bindController from '@/server/decorator/controller';
import type { Express } from 'express';
import { container } from 'tsyringe';
import { DataSource } from 'typeorm';
import pg from '../service/pg';
import openai from '../service/openai';
// import redis from '../service/redis';
import { InjectTokens } from '../utils';
import { AuthController } from './AuthController';
import { UserController } from './UserController';
import { ConversationController } from './ConversationController';
import { ChatController } from './ChatController';
import { AgentController } from './AgentController';
import { FileController } from './FileController';
import { TTSController } from './TTSController';

export default async (app: Express) => {
  if (!pg.isInitialized) {
    await pg.initialize();
  }

  // if (!redis.isReady) {
  //   await redis.connect();
  // }

  container.register<DataSource>(InjectTokens.PG, { useValue: pg });
  container.register<typeof openai>(InjectTokens.OPENAI, { useValue: openai });
  // container.register<typeof redis>(InjectTokens.REDIS, {
  //   useValue: redis,
  // });

  bindController(AuthController, app);
  bindController(UserController, app);
  bindController(ConversationController, app);
  bindController(ChatController, app);
  bindController(AgentController, app);
  bindController(FileController, app);
  bindController(TTSController, app);
};
