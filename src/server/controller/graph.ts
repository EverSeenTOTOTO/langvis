import { GraphEntity } from '@/shared/entities/Graph';
import { NodeEntity } from '@/shared/entities/Node';
import type { Request, Response } from 'express';
import { DataSource } from 'typeorm';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { inject } from '../decorator/inject';
import { Graph } from '../core/graph';
import { ButtonDTO } from '../core/nodes/Button';
import { mapNodeDTOFromDB } from '../core/mapDTO';

@controller('/api/graph')
export class GraphController {
  @inject()
  pg?: DataSource = undefined;

  @inject()
  graphs?: Map<string, Graph> = undefined;

  @api('/all')
  async getAllGraphs(_req: Request, res: Response) {
    const repo = this.pg!.getRepository(GraphEntity);
    const data = await repo.find();

    return res.json({ data });
  }

  @api('/detail/:graphId')
  async getGraphDetail(req: Request, res: Response) {
    const graphRepo = this.pg!.getRepository(GraphEntity);
    const graphId = req.params.graphId;
    const graph = await graphRepo.findOneBy({
      id: graphId,
    });

    const nodeRepo = this.pg!.getRepository(NodeEntity);
    const nodes = (
      await nodeRepo.findBy({
        graphId,
      })
    ).map(mapNodeDTOFromDB);

    this.initGraphRuntime({
      nodes,
      key: req.session!.id,
    });

    return res.json({
      data: {
        ...graph,
        nodes: nodes.map(each => each.toClient()),
      },
    });
  }

  initGraphRuntime({ nodes, key }: { nodes: ButtonDTO[]; key: string }) {
    if (this.graphs!.has(key)) return;

    const graph = new Graph();

    nodes.forEach(node => graph.addNode(node));
    this.graphs!.set(key, graph);
  }
}
