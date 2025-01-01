import { ClientNode, NodeState, ServerNode } from '@/shared/node';
import { Position } from '@xyflow/react';
import { Graph, Node } from '../graph';
import SlotHandle from '../slots/SlotHandle';

export class PipeNode extends Node implements ServerNode {
  state: NodeState;

  type: string = 'pipe';

  position: {
    x: number;
    y: number;
  };

  constructor(id: string, options: ClientNode, graph: Graph) {
    super(id);
    this.state = NodeState.Idle;
    this.position = options.position;
    this.state = options.data?.state || NodeState.Idle;

    const input = new SlotHandle('input', {
      type: 'target',
      position: Position.Left,
    });
    const output = new SlotHandle('output', {
      type: 'source',
      position: Position.Right,
    });

    this.defineSlot(input, msg => {
      const outputEdges = graph.getOutputEdges(output);

      outputEdges.forEach(edge => {
        const target = graph.getNode(edge.to);

        target?.emit(edge.to, msg);
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
