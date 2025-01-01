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
  Position,
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
      position: { x: -100, y: -100 },
      data: {
        children: 123,
        slots: [
          {
            name: 'output',
            type: 'target',
            position: Position.Right,
          },
        ],
      },
    },
    {
      id: 'btn-2',
      type: 'button',
      position: { x: 100, y: -50 },
      data: {
        children: 'hello',
        slots: [
          {
            name: 'input',
            type: 'source',
            position: Position.Left,
          },
        ],
      },
    },
  ];

  edges: Edge[] = [];

  nodeTypes: NodeTypes = {};

  flow?: ReactFlowInstance;

  constructor(root: AppStore) {
    this.root = root;

    const nodeTypes = import.meta.glob('@/client/components/GUINodes/*.tsx', {
      eager: true,
    }) as any;

    Object.keys(nodeTypes).forEach(path => {
      const type = path
        .match(/src\/client\/components\/GUINodes\/(.*)\.tsx$/)![1]
        .toLowerCase();

      this.registerNodeType(type, nodeTypes[path].default);
    });

    makeAutoObservable(this);
  }

  setFlow(flow: ReactFlowInstance) {
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
