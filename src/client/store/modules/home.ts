import { api, ApiRequest } from '@/client/decorator/api';
import { hydrate } from '@/client/decorator/hydrate';
import { GraphEntity } from '@/shared/entities/Graph';
import { NodeMetaEntity } from '@/shared/entities/NodeMeta';
import { ClientEdge, ClientNode } from '@/shared/types';
import { autorun, makeAutoObservable, observable, reaction } from 'mobx';
import { inject, singleton } from 'tsyringe';
import { GraphStore } from './graph';

@singleton()
export class HomeStore {
  @hydrate()
  availableGraphs: GraphEntity[] = [];

  @hydrate()
  availableNodemetas: NodeMetaEntity[] = [];

  @hydrate()
  currentGraphId?: GraphEntity['id'];

  constructor(@inject(GraphStore) private graph?: GraphStore) {
    makeAutoObservable(this, {
      availableGraphs: observable.shallow,
      availableNodemetas: observable.shallow,
    });

    autorun(() => {
      if (this.currentGraphId) {
        this.fetchGraphDetail({ graphId: this.currentGraphId });
      }
    });
    reaction(
      () => this.graph?.category,
      async () => {
        if (this.graph?.category) {
          await this.fetchAvailableNodemetasByGraphCategory({
            graphCategory: this.graph.category,
          });
        }
      },
    );
  }

  toggleGraph(id: string) {
    this.currentGraphId = id;
  }

  @api('/api/graph/all')
  async fetchAvailableGraphs(_params?: any, req?: ApiRequest) {
    const res = await req!.send();
    this.availableGraphs = res.data || [];

    if (!this.currentGraphId) {
      this.currentGraphId = res.data?.[0]?.id;
    }
  }

  @api('/api/graph/detail/:graphId')
  async fetchGraphDetail(_params: { graphId: string }, req?: ApiRequest) {
    const res = await req!.send();
    const nodes = res.data?.nodes || [];
    const edges = res.data?.edges || [];

    this.graph?.setCategory(res.data?.category);
    this.graph?.setNodes(nodes);
    this.graph?.setEdges(edges);
  }

  @api(
    (req: { graphCategory: string }) =>
      `/api/nodemeta/query?category=${req.graphCategory}`,
  )
  async fetchAvailableNodemetasByGraphCategory(
    _params: { graphCategory: string },
    req?: ApiRequest,
  ) {
    const res = await req!.send();
    this.availableNodemetas = res.data || [];
  }

  @api('/api/node/add', { method: 'post' })
  async createNode(_params: Partial<ClientNode>, req?: ApiRequest) {
    const res = await req!.send();

    if (res.data) {
      await this.fetchGraphDetail({ graphId: this.currentGraphId! });
    }
  }

  @api('/api/node/del/:id', { method: 'delete' })
  async deleteNode(params: { id: string }, req?: ApiRequest) {
    const res = await req!.send();

    if (res.data === params.id) {
      await this.fetchGraphDetail({ graphId: this.currentGraphId! });
    }
  }

  @api('/api/node/edit/:id', { method: 'post' })
  async editNode(params: Partial<ClientNode>, req?: ApiRequest) {
    const res = await req!.send();

    if (res.data && res.data.id === params.id) {
      await this.fetchGraphDetail({ graphId: this.currentGraphId! });
    }
  }

  @api('/api/edge/add', { method: 'post' })
  async addEdge(_params: Partial<ClientEdge>, req?: ApiRequest) {
    const res = await req!.send();

    if (res.data) {
      await this.fetchGraphDetail({ graphId: this.currentGraphId! });
    }
  }

  @api('/api/edge/del/:id', { method: 'delete' })
  async deleteEdge(params: { id: string }, req?: ApiRequest) {
    const res = await req!.send();

    if (res.data === params.id) {
      await this.fetchGraphDetail({ graphId: this.currentGraphId! });
    }
  }
}
