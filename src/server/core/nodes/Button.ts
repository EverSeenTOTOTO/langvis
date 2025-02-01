import { NodeEntity } from '@/shared/entities/Node';
import { ClientNode, NodeState, ServerNode } from '@/shared/types';
import { ButtonProps } from 'antd';
import { Graph, Slot } from '../graph';

export class ButtonDTO extends ServerNode<Partial<ButtonProps>> {
  entity?: NodeEntity;

  state: NodeState = NodeState.Init;

  fromDatabase(entity: NodeEntity) {
    this.id = entity.id;
    this.entity = entity;
    entity.data?.slots?.map((slot: any) => {
      this.defineSlot(
        new Slot(slot.name, {
          type: slot.type,
          position: slot.position,
        }),
      );
    });

    return this;
  }

  fromClient(node: ClientNode, ctx: Graph) {
    if (node.id && node.data?.slots) {
      // update
      node.data.slots.forEach((slot: Slot) => {
        if (!this.findSlot(slot.name)) {
          this.defineSlot(
            new Slot(slot.name, {
              type: slot.type,
              position: slot.position,
            }),
          );
        }
      });

      this.entity?.data.slots.forEach((slot: Slot) => {
        if (!node.data.slots!.find((s: Slot) => s.name === slot.name)) {
          ctx.deleteSlot(slot);
        }
      });
    }

    this.entity = {
      ...this.entity!,
      ...node,
      graphId: node.data.graphId!,
      name: node.data.name!,
      description: node.data.description!,
    };
    this.state = node.data.state || this.state;

    return this;
  }

  toClient() {
    return {
      ...this.entity!,
      data: {
        ...this.entity?.data,
        name: this.entity?.name,
        description: this.entity?.description,
        state: this.state,
      },
    };
  }

  toDatabase(): NodeEntity {
    return this.entity!;
  }
}
