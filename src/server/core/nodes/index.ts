import { ClientNode } from '@/shared/node';
import { Graph } from '../graph';
import { PipeNode } from './Pipe';

export const buildClientNode = (clientNode: ClientNode, graph: Graph) => {
  switch (clientNode.type) {
    case 'pipe':
    default:
      return new PipeNode(clientNode.id, clientNode, graph);
  }
};
