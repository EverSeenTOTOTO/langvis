import { NodeEntity } from '@/shared/entities/Node';
import { Layout, NodeState, ServerNode } from '@/shared/node';
import { Node, Slot } from '../graph';

export class Button extends Node implements ServerNode {
  entity!: NodeEntity;

  state: NodeState = NodeState.Init;

  layout?: Layout;

  // client or database node kept the same
  constructor(entity: NodeEntity) {
    super(String(entity.id));
    this.entity = entity;
    this.layout = entity.data?.layout;

    entity.data?.slots?.map((slot: any) => {
      this.defineSlot(
        new Slot(slot.name, {
          type: slot.type,
          position: slot.position,
        }),
      );
    });
  }
}
