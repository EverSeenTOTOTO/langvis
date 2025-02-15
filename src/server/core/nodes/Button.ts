import { NodeEntity } from '@/shared/entities/Node';
import { NodeMetaName } from '@/shared/entities/NodeMeta';
import { InstrinicNode, NodeState, ServerNode } from '@/shared/types';
import { Slot } from '../graph';

type ClientButton = Partial<InstrinicNode['button']>;

export class Button extends ServerNode {
  type = NodeMetaName.BUTTON;

  entity!: NodeEntity;

  state: NodeState = NodeState.Init;

  static fromDatabase(entity: NodeEntity, btn = new Button(entity.id)) {
    btn.id = entity.id; // clientNode(undefined) -> serverNode (undefined) -> dbNode(id) -> serverNode(+++ id)
    btn.entity = entity;

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
  static fromClient(node: ClientButton, btn = new Button(node.id!)) {
    btn.entity = {
      ...btn.entity!,
      ...node,
      graphId: node.data!.graphId!,
      name: node.data!.name!,
      description: node.data!.description!,
    };
    btn.state = node.data!.state || btn.state;

    return btn;
  }

  static toClient(node: Button): ClientButton {
    return {
      ...node.entity,
      data: {
        ...node.entity.data,
        name: node.entity.name,
        description: node.entity.description,
        graphId: node.entity.graphId,
        state: node.state,
        slots: node.entity.data?.slots ?? [],
      },
    };
  }

  static toDatabase(node: Button): NodeEntity {
    return node.entity!;
  }
}
