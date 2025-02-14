import { NodeEntity } from '@/shared/entities/Node';
import { ClientNode, ServerNode } from '@/shared/types';
import { singleton } from 'tsyringe';
import { ButtonDTO } from '../core/nodes/ButtonDTO';

@singleton()
export class NodeService {
  createNodeDTOFromDB(node: NodeEntity): ServerNode {
    switch (node.type) {
      case 'button':
        return new ButtonDTO(node.id).fromDatabase(node);
      default:
        throw new Error(
          `Failed to create DTO from database: not implemented. Node type: ${node.type}`,
        );
    }
  }

  createNodeDTOFromClient(node: ClientNode): ServerNode {
    switch (node.type) {
      case 'button':
        return new ButtonDTO(node.id).fromClient(node);
      default:
        throw new Error(
          `Failed to create DTO from client: not implemented. Node type: ${node.type}`,
        );
    }
  }

  updateNodeDTOFromClient(node: ServerNode, data: ClientNode): ServerNode {
    node.fromClient(data);
    return node;
  }

  updateNodeDTOFromDB(node: ServerNode, data: NodeEntity): ServerNode {
    node.fromDatabase(data);
    return node;
  }
}
