import { api, type ApiResponse } from '@/client/decorator/api';
import { NodeEntity } from '@/shared/entities/Node';
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Connection,
  Edge,
  EdgeChange,
  Node,
  NodeChange,
  type NodeTypes,
  ReactFlowInstance,
} from '@xyflow/react';
import { makeAutoObservable } from 'mobx';
import React from 'react';
import type { AppStore } from '..';

export class GraphStore {
  root: AppStore;

  nodes: Node[] = [];

  edges: Edge[] = [];

  nodeTypes: NodeTypes = {};

  flow?: ReactFlowInstance;

  constructor(root: AppStore) {
    this.root = root;

    const nodeTypes = import.meta.glob('@/client/components/Nodes/*.tsx', {
      eager: true,
    }) as any;

    Object.keys(nodeTypes).forEach(path => {
      const type = path
        .match(/src\/client\/components\/Nodes\/(.*)\.tsx$/)![1]
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

  @api(({ graphId }) => `/api/graph/detail/${graphId}`)
  async fetchGraphDetail(
    _req: { graphId?: number },
    res?: ApiResponse<{ nodes: NodeEntity[] }>,
  ) {
    const nodes = res!.data?.nodes.map(n => ({
      ...n,
      id: String(n.id),
      data: {
        ...n.data,
        name: n.name,
      },
    }));

    if (nodes) {
      this.nodes = nodes;
    }
  }
}
