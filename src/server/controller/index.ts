import bindController from '@/server/decorator/controller';
import type { Express } from 'express';
import pg from '../service/pg';
// import redis from '../service/redis';
import { AgentController } from './AgentController';
import { AuthController } from './AuthController';
import { ChatController } from './ChatController';
import { ConversationController } from './ConversationController';
import { FileController } from './FileController';
import { TTSController } from './TTSController';
import { UserController } from './UserController';

export default async (app: Express) => {
  if (!pg.isInitialized) {
    await pg.initialize();
  }

  // if (!redis.isReady) {
  //   await redis.connect();
  // }

  bindController(AuthController, app);
  bindController(UserController, app);
  bindController(ConversationController, app);
  bindController(ChatController, app);
  bindController(AgentController, app);
  bindController(FileController, app);
  bindController(TTSController, app);
};
