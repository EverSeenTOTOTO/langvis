import { api, type ApiResponse } from '@/client/decorator/api';
import { hydrate } from '@/client/decorator/hydrate';
import { GraphEntity } from '@/shared/entities/Graph';
import { NodeMetaEntity } from '@/shared/entities/NodeMeta';
import { ClientEdge, ClientNode } from '@/shared/types';
import { action, autorun, observable } from 'mobx';
import { inject, singleton } from 'tsyringe';
import { GraphStore } from './graph';

@singleton()
export class HomeStore {
  @observable.shallow
  @hydrate()
  availableGraphs: GraphEntity[] = [];

  @observable.shallow
  @hydrate()
  availableNodemetas: NodeMetaEntity[] = [];

  @observable
  @hydrate()
  currentGraphId?: GraphEntity['id'];

  constructor(@inject(GraphStore) private graph?: GraphStore) {
    autorun(() => {
      if (this.currentGraphId) {
        this.fetchGraphDetail({ graphId: this.currentGraphId });
      }
    });
  }

  @action
  toggleGraph(id: string) {
    this.currentGraphId = id;
  }

  @action
  @api('/api/graph/all')
  async fetchAvailableGraphs(_req: void, res?: ApiResponse<GraphEntity[]>) {
    this.availableGraphs = res!.data || [];
    this.currentGraphId = res!.data?.[0]?.id;
  }

  @action
  @api('/api/graph/init/:graphId')
  async fetchGraphDetail(
    _req: { graphId?: string },
    res?: ApiResponse<
      GraphEntity & { nodes: ClientNode[]; edges: ClientEdge[] }
    >,
  ) {
    const nodes = res!.data?.nodes || [];
    const edges = res!.data?.edges || [];

    this.graph?.setNodes(nodes);
    this.graph?.setEdges(edges);

    await this.fetchAvailableNodemetas({ graphCategory: res!.data!.category });
  }

  @action
  @api('/api/nodemeta/get/:graphCategory')
  async fetchAvailableNodemetas(
    _req: { graphCategory: string },
    res?: ApiResponse<NodeMetaEntity[]>,
  ) {
    this.availableNodemetas = res!.data || [];
  }

  @action
  @api('/api/node/create', { method: 'post' })
  async createNode(_req: Partial<ClientNode>, res?: ApiResponse<ClientNode>) {
    if (res!.data) {
      await this.fetchGraphDetail({ graphId: this.currentGraphId });
    }
  }

  @action
  @api('/api/node/delete/:id', { method: 'post' })
  async deleteNode(req: { id: string }, res?: ApiResponse<string>) {
    if (res!.data === req.id) {
      await this.fetchGraphDetail({ graphId: this.currentGraphId });
    }
  }

  @action
  @api('/api/node/update/:id', { method: 'post' })
  async updateNode(req: Partial<ClientNode>, res?: ApiResponse<ClientNode>) {
    if (res?.data && res.data.id === req?.id) {
      await this.fetchGraphDetail({ graphId: this.currentGraphId });
    }
  }

  @action
  @api('/api/edge/connect', { method: 'post' })
  async addEdge(_req: Partial<ClientEdge>, res?: ApiResponse<ClientEdge>) {
    if (res!.data) {
      await this.fetchGraphDetail({ graphId: this.currentGraphId });
    }
  }

  @action
  @api('/api/edge/delete/:id', { method: 'post' })
  async deleteEdge(req: { id: string }, res?: ApiResponse<string>) {
    if (res!.data === req.id) {
      await this.fetchGraphDetail({ graphId: this.currentGraphId });
    }
  }
}
