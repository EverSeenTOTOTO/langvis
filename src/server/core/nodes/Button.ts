import { NodeEntity } from '@/shared/entities/Node';
import { NodeMetaName } from '@/shared/entities/NodeMeta';
import { InstrinicNode } from '@/shared/types';
import { Slot } from '../graph';
import { ServerNode } from '../server-node';

type ClientButton = InstrinicNode['button'];

export class Button extends ServerNode {
  type = NodeMetaName.BUTTON;

  static fromDatabase(entity: NodeEntity, node?: Button) {
    const btn =
      node ||
      new Button(
        entity.id,
        entity.position,
        entity.data as ClientButton['data'],
      );

    // clientNode() -> serverNode() -> dbNode(id) -> serverNode(+++ id)
    btn.id = entity.id;

    entity.data?.slots?.map((slot: any) => {
      btn.defineSlot(
        new Slot(slot.name, {
          type: slot.type,
          position: slot.position,
        }),
      );
    });

    return btn;
  }

  // TODO: validate
  static fromClient(clientNode: ClientButton, node?: Button) {
    const btn =
      node ||
      new Button(clientNode.id!, clientNode!.position!, clientNode.data!);

    btn.position = clientNode.position;
    btn.data = clientNode.data;

    return btn;
  }

  static toClient(node: Button): ClientButton {
    return {
      id: node.id,
      type: node.type,
      position: node.position,
      data: {
        ...(node.data as ClientButton['data']),
        name: node.data?.name,
        description: node.data?.description,
        graphId: node.data?.graphId,
        state: node.state,
        slots: node.data?.slots ?? [],
      },
    };
  }

  static toDatabase(node: Button): Partial<NodeEntity> {
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
