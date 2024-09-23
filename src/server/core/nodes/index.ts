import { ClientNode } from '@/shared/node';
import { ButtonNode } from './Button';
import { Context } from '../context';
import { PipeNode } from './Pipe';

export const buildClientNode = (clientNode: ClientNode, ctx: Context) => {
  switch (clientNode.type) {
    case 'pipe':
      return new PipeNode(clientNode.id, clientNode, ctx);
    case 'button':
      return new ButtonNode(clientNode.id, clientNode, ctx);
    default:
      throw new Error(`Unknown node type: ${clientNode.type}`);
  }
};
