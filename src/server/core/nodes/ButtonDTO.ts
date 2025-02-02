import { NodeEntity } from '@/shared/entities/Node';
import { ClientNode, NodeState, ServerNode } from '@/shared/types';
import { ButtonProps } from 'antd';
import { Slot } from '../graph';

export class ButtonDTO extends ServerNode<Partial<ButtonProps>> {
  entity!: NodeEntity;

  state: NodeState = NodeState.Init;

  fromDatabase(entity: NodeEntity) {
    this.id = entity.id; // newly created
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

  fromClient(node: ClientNode) {
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
      ...this.entity,
      name: undefined,
      description: undefined,
      graphId: undefined,
      data: {
        ...this.entity.data,
        name: this.entity.name,
        description: this.entity.description,
        graphId: this.entity.graphId,
        state: this.state,
        slots: this.entity.data?.slots ?? [],
      },
    };
  }

  toDatabase(): NodeEntity {
    return this.entity!;
  }
}
