import { NodeEntity } from '@/shared/entities/Node';
import { NodeMetaName } from '@/shared/entities/NodeMeta';
import { ClientNode, ServerNode } from '@/shared/types';
import { singleton } from 'tsyringe';
import { Button } from '../core/nodes/Button';

@singleton()
export class NodeService {
  createNodeDTOFromDB(node: NodeEntity): ServerNode {
    switch (node.type) {
      case NodeMetaName.BUTTON:
        return Button.fromDatabase(node);
      default:
        throw new Error(
          `Failed to create DTO from database: not implemented. Node type: ${node.type}`,
        );
    }
  }

  createNodeDTOFromClient(node: ClientNode): ServerNode {
    switch (node.type) {
      case NodeMetaName.BUTTON:
        return Button.fromClient(node);
      default:
        throw new Error(
          `Failed to create DTO from client: not implemented. Node type: ${node.type}`,
        );
    }
  }

  updateNodeDTOFromClient(node: ServerNode, data: ClientNode): ServerNode {
    switch (data.type) {
      case NodeMetaName.BUTTON:
        return Button.fromClient(data, node as Button);
      default:
        throw new Error(
          `Failed to update DTO from client: not implemented. Node type: ${data.type}`,
        );
    }
  }

  updateNodeDTOFromDB(node: ServerNode, data: NodeEntity): ServerNode {
    switch (data.type) {
      case NodeMetaName.BUTTON:
        return Button.fromDatabase(data, node as Button);
      default:
        throw new Error(
          `Failed to update DTO from database: not implemented. Node type: ${data.type}`,
        );
    }
  }

  toClientNode(node: ServerNode): ClientNode {
    switch (node.type) {
      case NodeMetaName.BUTTON:
        return Button.toClient(node as Button);
      default:
        throw new Error(
          `Failed to convert client node: not implemented. Node type: ${node.type}`,
        );
    }
  }

  toDatabaseNode(node: ServerNode): NodeEntity {
    switch (node.type) {
      case NodeMetaName.BUTTON:
        return Button.toDatabase(node as Button);
      default:
        throw new Error(
          `Failed to convert database node: not implemented. Node type: ${node.type}`,
        );
    }
  }
}
