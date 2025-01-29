import bindController from '@/server/decorator/controller';
import type { Express } from 'express';
import supabase from '../service/supabase';
import { GraphController } from "./graph";

export default async (app: Express) => {
  const pool = { supabase };

  bindController(GraphController, app, pool);
};
