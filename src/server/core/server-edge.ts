import { Edge, Slot } from '@/server/core/graph';
import { EdgeMetaName } from '@/shared/entities/Edge';
import { ClientEdge } from '@/shared/types';

export class ServerEdge extends Edge {
  type: EdgeMetaName = EdgeMetaName.BEZIER;
  data: ClientEdge['data'];

  constructor(
    id: string,
    source: Slot,
    target: Slot,
    data: ClientEdge['data'],
  ) {
    super(id, source, target);
    this.data = data;
  }

  // TODO: fromClient, fromDb, toClient, toDb
}
