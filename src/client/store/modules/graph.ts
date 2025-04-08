import type { ReactFlowInstance, Connection } from '@xyflow/react';
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Edge,
  EdgeChange,
  Node,
  NodeChange,
} from '@xyflow/react';
import { action, observable } from 'mobx';
import { singleton } from 'tsyringe';

@singleton()
export class GraphStore {
  @observable.shallow
  nodes: Node[] = [];

  @observable.shallow
  edges: Edge[] = [];

  @observable
  flow?: ReactFlowInstance;

  @action
  setFlow(flow: ReactFlowInstance) {
    this.flow = flow;
  }

  @action
  setNodes(nodes: Node[]) {
    this.nodes = nodes;
  }

  @action
  setEdges(edges: Edge[]) {
    this.edges = edges;
  }

  @action
  // sync graph state with app state
  updateNodes(changes: NodeChange<Node>[]) {
    this.nodes = applyNodeChanges(changes, this.nodes);
  }

  @action
  updateEdges(changes: EdgeChange[]) {
    this.edges = applyEdgeChanges(changes, this.edges);
  }

  @action
  connectNode(connection: Connection) {
    this.edges = addEdge({ ...connection, type: 'bezier' }, this.edges);
  }
}
