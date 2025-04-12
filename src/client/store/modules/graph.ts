import type { Connection, ReactFlowInstance } from '@xyflow/react';
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Edge,
  EdgeChange,
  Node,
  NodeChange,
} from '@xyflow/react';
import { makeAutoObservable, observable } from 'mobx';
import { singleton } from 'tsyringe';

@singleton()
export class GraphStore {
  nodes: Node[] = [];

  edges: Edge[] = [];

  flow?: ReactFlowInstance;

  constructor() {
    makeAutoObservable(this, {
      nodes: observable.shallow,
      edges: observable.shallow,
    });
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
