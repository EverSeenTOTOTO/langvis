import { api, ApiRequest } from '@/client/decorator/api';
import { hydrate } from '@/client/decorator/hydrate';
import { GraphEntity } from '@/shared/entities/Graph';
import { NodeMetaEntity } from '@/shared/entities/NodeMeta';
import { ClientEdge, ClientNode } from '@/shared/types';
import { autorun, makeAutoObservable, observable } from 'mobx';
import { inject, singleton } from 'tsyringe';
import { GraphStore } from './graph';
import { SSEStore } from './sse';

@singleton()
export class HomeStore {
  @hydrate()
  availableGraphs: GraphEntity[] = [];

  @hydrate()
  availableNodemetas: NodeMetaEntity[] = [];

  @hydrate()
  currentGraphId?: GraphEntity['id'];

  graphState?: 'BUILD' | 'VIEW' | 'RUNNING' = 'BUILD';

  constructor(
    @inject(GraphStore) private graph?: GraphStore,
    @inject(SSEStore) private sse?: SSEStore,
  ) {
    makeAutoObservable(this, {
      availableGraphs: observable.shallow,
      availableNodemetas: observable.shallow,
    });

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
  async runCurrentGraph(_params?: any, req?: ApiRequest) {
    await this.sse?.connect();
    this.sse?.register(`graph:${this.currentGraphId}`, console.log);

    const res = await req!.send();

    console.log(res);
  }

  @api('/api/graph/all')
  async fetchAvailableGraphs(_params?: any, req?: ApiRequest) {
    const res = await req!.send();
    this.availableGraphs = res.data || [];
    this.currentGraphId = res.data?.[0]?.id;
  }

  @api('/api/graph/get/:graphId')
  async fetchGraphDetail(_params: { graphId: string }, req?: ApiRequest) {
    const res = await req!.send();
    const nodes = res.data?.nodes || [];
    const edges = res.data?.edges || [];

    this.graph?.setNodes(nodes);
    this.graph?.setEdges(edges);

    if (res.data?.category) {
      await this.fetchAvailableNodemetas({
        graphCategory: res.data.category,
      });
    }
  }

  @api('/api/nodemeta/get/:graphCategory')
  async fetchAvailableNodemetas(
    _params: { graphCategory: string },
    req?: ApiRequest,
  ) {
    const res = await req!.send();
    this.availableNodemetas = res.data || [];
  }

  @api('/api/node/create', { method: 'post' })
  async createNode(_params: Partial<ClientNode>, req?: ApiRequest) {
    const res = await req!.send();

    if (res.data) {
      await this.fetchGraphDetail({ graphId: this.currentGraphId! });
    }
  }

  @api('/api/node/delete/:id', { method: 'post' })
  async deleteNode(params: { id: string }, req?: ApiRequest) {
    const res = await req!.send();

    if (res.data === params.id) {
      await this.fetchGraphDetail({ graphId: this.currentGraphId! });
    }
  }

  @api('/api/node/update/:id', { method: 'post' })
  async updateNode(params: Partial<ClientNode>, req?: ApiRequest) {
    const res = await req!.send();

    if (res.data && res.data.id === params.id) {
      await this.fetchGraphDetail({ graphId: this.currentGraphId! });
    }
  }

  @api('/api/edge/create', { method: 'post' })
  async addEdge(_params: Partial<ClientEdge>, req?: ApiRequest) {
    const res = await req!.send();

    if (res.data) {
      await this.fetchGraphDetail({ graphId: this.currentGraphId! });
    }
  }

  @api('/api/edge/delete/:id', { method: 'post' })
  async deleteEdge(params: { id: string }, req?: ApiRequest) {
    const res = await req!.send();

    if (res.data === params.id) {
      await this.fetchGraphDetail({ graphId: this.currentGraphId! });
    }
  }
}
