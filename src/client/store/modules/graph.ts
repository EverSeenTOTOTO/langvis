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
  category?: string;

  nodes: Node[] = [];

  edges: Edge[] = [];

  flow?: ReactFlowInstance;

  constructor() {
    makeAutoObservable(this, {
      nodes: observable.shallow,
      edges: observable.shallow,
    });
  }

  setCategory(category?: string) {
    this.category = category;
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

  getNode(id: string) {
    return this.nodes.find(n => n.id === id);
  }

  setNode(id: string, node: Node | ((n: Node) => Node)) {
    this.nodes = this.nodes.map(n =>
      n.id === id
        ? {
            ...(typeof node === 'function' ? node(n) : node),
            ...node,
          }
        : n,
    );

    return this;
  }

  setNodeData(id: string, data: any) {
    return this.setNode(id, node => ({
      ...node,
      data: {
        ...node.data,
        ...data,
      },
    }));
  }

  getEdge(id: string) {
    return this.edges.find(e => e.id === id);
  }

  setEdge(id: string, edge: Edge | ((e: Edge) => Edge)) {
    this.edges = this.edges.map(e =>
      e.id === id
        ? {
            ...(typeof edge === 'function' ? edge(e) : edge),
            ...edge,
          }
        : e,
    );

    return this;
  }

  setEdgeData(id: string, data: any) {
    return this.setEdge(id, edge => ({
      ...edge,
      data: {
        ...edge.data,
        ...data,
      },
    }));
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
