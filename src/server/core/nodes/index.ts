import { ClientNode } from '@/shared/node';
import { Context } from '../context';
import { PipeNode } from './Pipe';

export const buildClientNode = (clientNode: ClientNode, ctx: Context) => {
  switch (clientNode.type) {
    case 'pipe':
    default:
      return new PipeNode(clientNode.id, clientNode, ctx);
  }
};
