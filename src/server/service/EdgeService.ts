import { EdgeEntity } from '@/shared/entities/Edge';
import { ClientEdge } from '@/shared/types';
import { inject, singleton } from 'tsyringe';
import { ServerEdge } from '../core/server-edge';
import { GraphService } from './GraphService';

@singleton()
export class EdgeService {
  constructor(@inject(GraphService) private graphService?: GraphService) {}

  createFromClient(key: string, edge: ClientEdge): ServerEdge {
    const graph = this.graphService!.getGraph(key);
    const source = graph.getNode(edge.source)!.getSlot('source')!;
    const target = graph.getNode(edge.target)!.getSlot('target')!;

    return new ServerEdge(edge.id, source, target, edge.data);
  }

  createFromDB(key: string, edge: EdgeEntity): ServerEdge {
    const graph = this.graphService!.getGraph(key);
    const source = graph.getNode(edge.source)!.getSlot('source')!;
    const target = graph.getNode(edge.target)!.getSlot('target')!;

    return new ServerEdge(
      edge.id,
      source,
      target,
      edge.data as ServerEdge['data'],
    );
  }

  updateFromDB(edge: ServerEdge, data: EdgeEntity): ServerEdge {
    edge.id = data.id;
    return edge;
  }

  toClient(key: string, edge: ServerEdge): Partial<ClientEdge> {
    const graph = this.graphService!.getGraph(key);
    const source = graph.getNode(edge.from);
    const target = graph.getNode(edge.to);

    return {
      id: edge.id,
      type: edge.type,
      source: source?.id,
      target: target?.id,
      data: edge.data,
    };
  }

  toDatabase(key: string, edge: ServerEdge): Partial<EdgeEntity> {
    const graph = this.graphService!.getGraph(key);
    const source = graph.getNode(edge.from)!;
    const target = graph.getNode(edge.to)!;

    return {
      ...edge,
      source: source.id,
      target: target.id,
      graphId: edge.data!.graphId,
    };
  }
}
