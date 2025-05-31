import { EdgeEntity, EdgeMetaName } from '@/shared/entities/Edge';
import { InstrinicEdge, EdgeState } from '@/shared/types';

type ClientBezierEdge = InstrinicEdge['bezier'];

export class Bezier {
  type = EdgeMetaName.BEZIER;

  static toClient(edge: EdgeEntity): ClientBezierEdge {
    return {
      id: edge.id,
      type: edge.type,
      source: edge.source,
      target: edge.target,
      data: {
        ...(edge.data as ClientBezierEdge['data']),
        graphId: edge.data?.graphId,
        state: EdgeState.Idle, // TODO
      },
    };
  }

  static toDatabase(edge: ClientBezierEdge): Omit<EdgeEntity, 'graph'> {
    return {
      id: edge.id,
      type: edge.type!,
      graphId: edge.data!.graphId!,
      target: edge.target,
      source: edge.source,
      data: edge.data!,
    };
  }
}
