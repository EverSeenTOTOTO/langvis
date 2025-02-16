import { NodeEntity } from '@/shared/entities/Node';
import { NodeMetaName } from '@/shared/entities/NodeMeta';
import { ClientNode, InstrinicNode } from '@/shared/types';
import { singleton } from 'tsyringe';
import { Button } from '../core/nodes/Button';
import { ServerNode } from '../core/server-node';

@singleton()
export class NodeService {
  createFromDB(node: NodeEntity): ServerNode {
    switch (node.type) {
      case NodeMetaName.BUTTON:
        return Button.fromDatabase(node);
      default:
        throw new Error(
          `Failed to create DTO from database: not implemented. Node type: ${node.type}`,
        );
    }
  }

  createFromClient(node: ClientNode): ServerNode {
    switch (node.type) {
      case NodeMetaName.BUTTON:
        return Button.fromClient(node as InstrinicNode['button']);
      default:
        throw new Error(
          `Failed to create DTO from client: not implemented. Node type: ${node.type}`,
        );
    }
  }

  updateFromClient(node: ServerNode, data: ClientNode): ServerNode {
    switch (data.type) {
      case NodeMetaName.BUTTON:
        return Button.fromClient(
          data as InstrinicNode['button'],
          node as Button,
        );
      default:
        throw new Error(
          `Failed to update DTO from client: not implemented. Node type: ${data.type}`,
        );
    }
  }

  updateFromDB(node: ServerNode, data: NodeEntity): ServerNode {
    switch (data.type) {
      case NodeMetaName.BUTTON:
        return Button.fromDatabase(data, node as Button);
      default:
        throw new Error(
          `Failed to update DTO from database: not implemented. Node type: ${data.type}`,
        );
    }
  }

  toClient(node: ServerNode): Partial<ClientNode> {
    switch (node.type) {
      case NodeMetaName.BUTTON:
        return Button.toClient(node as Button);
      default:
        throw new Error(
          `Failed to convert client node: not implemented. Node type: ${node.type}`,
        );
    }
  }

  toDatabase(node: ServerNode): Partial<NodeEntity> {
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
