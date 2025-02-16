import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Connection,
  Edge,
  EdgeChange,
  Node,
  NodeChange,
  ReactFlowInstance,
} from '@xyflow/react';
import { makeAutoObservable } from 'mobx';
import { singleton } from 'tsyringe';

@singleton()
export class GraphStore {
  nodes: Node[] = [];

  edges: Edge[] = [];

  flow?: ReactFlowInstance;

  constructor() {
    makeAutoObservable(this);
  }

  setFlow(flow: ReactFlowInstance) {
    this.flow = flow;
  }

  setNodes(nodes: Node[]) {
    this.nodes = nodes;
  }

  setEdges(edges: Edge[]) {
    this.edges = edges;
  }

  // sync graph state with app state
  updateNodes(changes: NodeChange<Node>[]) {
    this.nodes = applyNodeChanges(changes, this.nodes);
  }

  updateEdges(changes: EdgeChange[]) {
    this.edges = applyEdgeChanges(changes, this.edges);
  }

  connectNode(connection: Connection) {
    this.edges = addEdge({ ...connection, type: 'bezier' }, this.edges);
  }
}
