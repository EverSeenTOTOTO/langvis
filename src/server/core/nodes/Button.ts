import { InstrinicNodes, Layout, NodeState, ServerNode } from '@/shared/node';
import { Position } from '@xyflow/react';
import { Node, Slot } from '../graph';

export class ButtonNode extends Node implements ServerNode {
  type = 'button';

  position: ServerNode['position'];

  state: NodeState;

  layout: Layout;

  text: string;

  constructor(options: InstrinicNodes['button']) {
    super(options.id);

    this.position = options.position;
    this.state = options.data?.state || NodeState.Idle;
    this.layout = options.data?.layout || 'vertical';
    this.text = options.data.text;

    this.defineSlot(
      new Slot('input', {
        type: 'target',
        position: this.layout === 'horizontal' ? Position.Left : Position.Top,
      }),
    );
    this.defineSlot(
      new Slot('output', {
        type: 'source',
        position:
          this.layout === 'horizontal' ? Position.Right : Position.Bottom,
      }),
    );
  }

  toClient() {
    return {
      id: this.id,
      type: this.type,
      position: this.position,
      data: {
        state: this.state,
        layout: this.layout,
        text: this.text,
        slots: [...this.slots.values()],
      },
    };
  }
}
