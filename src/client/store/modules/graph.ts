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
import type { AppStore } from '..';

export class GraphStore {
  root: AppStore;

  nodes: Node[] = [];

  edges: Edge[] = [];

  flow?: ReactFlowInstance;

  constructor(root: AppStore) {
    this.root = root;

    makeAutoObservable(this);
  }

  setFlow(flow: ReactFlowInstance) {
    this.flow = flow;
  }

  // sync graph state with app state
  updateNodes(changes: NodeChange<Node>[]) {
    this.nodes = applyNodeChanges(changes, this.nodes);
  }

  updateEdges(changes: EdgeChange[]) {
    this.edges = applyEdgeChanges(changes, this.edges);
  }

  connectNode(connection: Connection) {
    this.edges = addEdge(connection, this.edges);
  }
}
