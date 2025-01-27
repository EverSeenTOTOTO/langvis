import { Layout, NodeState, ServerNode } from '@/shared/node';
import { Node, Slot } from '../graph';

export class Button extends Node implements ServerNode {
  type = 'button';

  name?: string;

  position = { x: 0, y: 0 };

  state: NodeState = NodeState.Init;

  layout?: Layout;

  // client or database node kept the same
  static fromJSON(record: Record<string, any>) {
    const node = new Button(record.id);

    node.id = record.id;
    node.name = record.data.name;
    node.state = record.data.state || node.state;
    node.layout = record.data.layout;
    node.position = record.position || node.position;

    record.data?.slots?.map((slot: any) => {
      node.defineSlot(
        new Slot(slot.name, {
          type: slot.type,
          position: slot.position,
        }),
      );
    });

    return node;
  }

  static toJSON(node: Button) {
    return {
      id: node.id,
      type: node.type,
      position: node.position,
      data: {
        name: node.name,
        state: node.state,
        layout: node.layout,
        slots: [...node.slots.values()],
      },
    };
  }
}
