import { SupabaseClient } from '@supabase/supabase-js';
import type { Request, Response } from 'express';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { inject } from '../decorator/inject';

@controller('/api/graph')
export class GraphController {
  @inject()
  supabase?: SupabaseClient = undefined;

  @api('/all')
  async getAllGraphs(_req: Request, res: Response) {
    const data = await this.supabase!.from('graph').select();

    return res.json(data);
  }

  @api('/detail/:graphId')
  async getGraphDetail(req: Request, res: Response) {
    const graphId = req.params.graphId;
    const data = await this.supabase!.from('node')
      .select()
      .eq('graph_id', graphId);

    return res.json(data);
  }
}
