import { Node } from '@/server/core/graph';
import { XYPosition } from '@xyflow/react';
import { NodeMetaName } from '@/shared/entities/NodeMeta';
import { ClientNode, NodeState } from '@/shared/types';

export class ServerNode extends Node {
  type: NodeMetaName = NodeMetaName.DEFAULT;
  state: NodeState = NodeState.Init;
  data: ClientNode['data'];
  position: XYPosition = { x: 0, y: 0 };

  constructor(id: string, position: XYPosition, data: ClientNode['data']) {
    super(id);
    this.data = data;
    this.position = position || this.position;
    this.state = data.state || this.state;
  }
}
