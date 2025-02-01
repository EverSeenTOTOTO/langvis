import { api, type ApiResponse } from '@/client/decorator/api';
import { hydrate } from '@/client/decorator/hydrate';
import { GraphEntity } from '@/shared/entities/Graph';
import { NodeMetaEntity } from '@/shared/entities/NodeMeta';
import { type ClientNode } from '@/shared/types';
import { autorun, makeAutoObservable } from 'mobx';
import { type AppStore } from '..';

export class HomeStore {
  root: AppStore;

  @hydrate()
  availableGraphs: GraphEntity[] = [];

  @hydrate()
  availableNodemetas: NodeMetaEntity[] = [];

  @hydrate()
  currentGraphId?: GraphEntity['id'];

  constructor(root: AppStore) {
    makeAutoObservable(this);
    this.root = root;

    autorun(() => {
      if (this.currentGraphId) {
        this.fetchGraphDetail({ graphId: this.currentGraphId });
      }
    });
  }

  toggleGraph(id: string) {
    this.currentGraphId = id;
  }

  @api('/api/graph/all')
  async fetchAvailableGraphs(_req: void, res?: ApiResponse<GraphEntity[]>) {
    this.availableGraphs = res!.data || [];
    this.currentGraphId = res!.data?.[0]?.id;
  }

  @api('/api/graph/detail/:graphId')
  async fetchGraphDetail(
    _req: { graphId?: string },
    res?: ApiResponse<GraphEntity & { nodes: ClientNode[] }>,
  ) {
    const nodes = res!.data?.nodes;

    if (nodes) {
      this.root.graph.nodes = nodes;
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

  @api('/api/node/create', { method: 'post' })
  async createNode(_req: Partial<ClientNode>, res?: ApiResponse<ClientNode>) {
    if (res!.data) {
      this.root.graph.createNode(res!.data);
    }
  }

  @api('/api/node/delete/:id', { method: 'post' })
  async deleteNode(req: { id: string }, res?: ApiResponse<string>) {
    if (res!.data === req.id) {
      this.root.graph.deleteNode(req.id);
    }
  }

  @api('/api/node/update/:id', { method: 'post' })
  async updateNode(req: Partial<ClientNode>, res?: ApiResponse<ClientNode>) {
    if (res!.data && res!.data.id === req?.id) {
      this.root.graph.updateNode(res!.data);
    }
  }
}
