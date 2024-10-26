import { ClientNode, NodeState, ServerNode } from '@/shared/node';
import { Position } from '@xyflow/react';
import { Context, Node } from '../context';
import SlotHandle from './SlotHandle';

export class PipeNode extends Node implements ServerNode {
  state: NodeState;

  type: string = 'pipe';

  position: {
    x: number;
    y: number;
  };

  constructor(id: string, options: ClientNode, ctx: Context) {
    super(id);
    this.state = NodeState.Initial;
    this.position = options.position;
    this.state = options.data?.state || NodeState.Initial;

    const input = new SlotHandle('input', {
      type: 'target',
      position: Position.Left,
    });
    const output = new SlotHandle('output', {
      type: 'source',
      position: Position.Right,
    });

    this.defineSlot(input, msg => {
      const outputEdges = ctx.getOutputEdges(output);

      outputEdges.forEach(edge => {
        const target = ctx.getNode(edge.to);

        target?.emit(edge.to.name, msg);
      });
    });
    this.defineSlot(output);
  }

  toClient(): ClientNode {
    return {
      id: this.id,
      type: this.type,
      position: this.position,
      data: {
        state: this.state,
        slots: [...this.slots.values()],
      },
    };
  }
}
