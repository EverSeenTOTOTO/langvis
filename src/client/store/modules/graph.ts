import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Connection,
  Edge,
  EdgeChange,
  Node,
  NodeChange,
  NodeTypes,
  ReactFlowInstance,
} from '@xyflow/react';
import { makeAutoObservable } from 'mobx';
import React from 'react';
import type { AppStore } from '..';

export class GraphStore {
  root: AppStore;

  nodes: Node[] = [
    {
      id: 'btn-1',
      type: 'button',
      position: { x: 0, y: 0 },
      data: { children: 123 },
    },
    {
      id: 'btn-2',
      type: 'button',
      position: { x: 100, y: 200 },
      data: { children: 'hello' },
    },
  ];

  edges: Edge[] = [];

  nodeTypes: NodeTypes = {};

  flow?: ReactFlowInstance;

  constructor(root: AppStore) {
    this.root = root;

    makeAutoObservable(this);
  }

  initFlow(flow: ReactFlowInstance) {
    this.flow = flow;
  }

  registerNodeType(type: string, component: React.FC<any>) {
    this.nodeTypes[type] = component;
  }

  unregisterNodeType(type: string) {
    delete this.nodeTypes[type];
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
