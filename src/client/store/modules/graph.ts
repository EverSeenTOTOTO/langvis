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

const nodeTypes = import.meta.glob('@/client/components/GUINodes/*.tsx', {
  eager: true,
}) as any;

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
    Object.keys(nodeTypes).forEach(path => {
      const type = path
        .match(/src\/client\/components\/GUINodes\/(.*)\.tsx$/)![1]
        .toLowerCase();

      this.registerNodeType(type, nodeTypes[path].default);
    });

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

  buildGraph() {
    fetch('/api/graph/build', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        nodes: this.nodes,
        edges: this.edges,
      }),
    })
      .then(rsp => rsp.json())
      .then(data => {
        const idMap = new Map<string, string>(); // old config id -> runtime id

        data.nodes.forEach((node: Node) => {
          const runtimeId = (node.data?.id as string) || node.id;

          idMap.set(node.id, runtimeId);
          this.flow?.updateNode(node.id, {
            ...node,
            id: runtimeId,
          });
        });
        data.edges.forEach((edge: Edge) => {
          const runtimeId = (edge.data?.id as string) || edge.id;

          this.flow?.updateEdge(edge.id, {
            ...edge,
            source: idMap.get(edge.source)!,
            target: idMap.get(edge.target)!,
            id: runtimeId,
          });
        });
      });
  }

  executeGraph() {
    fetch('/api/graph/exec', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        nodeId: this.nodes[1].id,
        slot: 'input',
        msg: 'demo',
      }),
    });
  }
}
