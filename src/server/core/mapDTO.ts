import { NodeEntity } from '@/shared/entities/Node';
import { ButtonDTO } from './nodes/Button';
import { ClientNode } from '@/shared/types';
import { Graph } from './graph';

export const mapNodeDTOFromDB = (node: NodeEntity) => {
  switch (node.type) {
    case 'button':
    default:
      return new ButtonDTO(node.id).fromDatabase(node);
  }
};

export const mapNodeDTOFromClient = (node: ClientNode, ctx: Graph) => {
  switch (node.type) {
    case 'button':
    default:
      return new ButtonDTO(node.id).fromClient(node, ctx);
  }
};
