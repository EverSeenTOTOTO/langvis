import { api, type ApiResponse } from '@/client/decorator/api';
import { hydrate } from '@/client/decorator/hydrate';
import { GraphEntity } from '@/shared/entities/Graph';
import { NodeEntity } from '@/shared/entities/Node';
import { NodeMetaEntity } from '@/shared/entities/NodeMeta';
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

  @hydrate()
  availableNodemetas: NodeMetaEntity[] = [];

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

  @api('/api/graph/detail/:graphId')
  async fetchGraphDetail(
    _req: { graphId?: string },
    res?: ApiResponse<GraphEntity & { nodes: NodeEntity[] }>,
  ) {
    const nodes = res!.data?.nodes.map(n => ({
      ...n,
      data: {
        ...n.data,
        name: n.name,
      },
    }));

    if (nodes) {
      this.nodes = nodes;
    }

    this.fetchAvailableNodemetas({ graphCategory: res!.data!.category });
  }

  @api('/api/nodemeta/get/:graphCategory')
  async fetchAvailableNodemetas(
    _req: { graphCategory: string },
    res?: ApiResponse<NodeMetaEntity[]>,
  ) {
    this.availableNodemetas = res!.data || [];
  }

  @api('/api/node/update/:nodeId', { method: 'post' })
  async updateNode(req: { nodeId: string }, res?: ApiResponse<string>) {
    if (res!.data === req?.nodeId) {
      this.fetchGraphDetail({ graphId: this.root.home.currentGraphId });
    }
  }
}
