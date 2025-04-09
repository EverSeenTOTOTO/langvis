import { NodeEntity } from '@/shared/entities/Node';
import { NodeMetaName } from '@/shared/entities/NodeMeta';
import { InstrinicNode, NodeState } from '@/shared/types';

type ClientButton = InstrinicNode['button'];

export class Button {
  type = NodeMetaName.BUTTON;

  static toClient(node: NodeEntity): ClientButton {
    return {
      id: node.id,
      type: node.type,
      position: node.position,
      data: {
        ...(node.data as ClientButton['data']),
        name: node.data?.name,
        description: node.data?.description,
        graphId: node.data?.graphId,
        state: NodeState.Idle, // TODO
        slots: node.data?.slots ?? [],
      },
    };
  }

  static toDatabase(node: ClientButton): Partial<NodeEntity> {
    return {
      id: node.id,
      type: node.type,
      position: node.position,
      graphId: node.data.graphId,
      name: node.data.name,
      description: node.data.description,
      data: node.data,
    };
  }
}
