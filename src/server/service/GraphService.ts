import { GraphEntity } from '@/shared/entities/Graph';
import { inject, singleton } from 'tsyringe';
import { DataSource } from 'typeorm';
import { EdgeService } from './EdgeService';
import { NodeService } from './NodeService';
import { pgInjectToken } from './pg';
import type { RedisClientType } from 'redis';
import { ClientEdge, ClientNode } from '@/shared/types';
import { redisInjectToken } from './redis';
import { SSEService } from './SSEService';

@singleton()
export class GraphService {
  constructor(
    @inject(NodeService) private nodeService?: NodeService,
    @inject(EdgeService) private edgeService?: EdgeService,
    @inject(pgInjectToken) private pg?: DataSource,
    @inject(redisInjectToken) private redis?: RedisClientType<any>,
    @inject(SSEService) private sseService?: SSEService,
  ) {}

  findAll() {
    return this.pg!.getRepository(GraphEntity).find();
  }

  async findByGraphId(graphId: string) {
    const graphRepo = this.pg!.getRepository(GraphEntity);
    const graph = await graphRepo.findOneBy({
      id: graphId,
    });

    const nodes = await this.nodeService!.findByGraphId(graphId);
    const edges = await this.edgeService!.findByGraphId(graphId);

    const data = { ...graph, nodes, edges };

    return data;
  }

  async getCache(sessionId: string, graphId: string) {
    const cache = await this.redis!.hGet(sessionId, graphId);

    if (cache) {
      return JSON.parse(cache) as GraphEntity & {
        nodes: ClientNode[];
        edges: ClientEdge[];
      };
    }

    return null;
  }

  async cleanCache(sessionId: string, graphId: string) {
    await this.redis!.hDel(sessionId, graphId);
  }

  async refreshCache(sessionId: string, graphId: string) {
    const data = await this.findByGraphId(graphId);
    const encodedData = JSON.stringify(data);
    await this.redis!.hSet(sessionId, graphId, encodedData);
    return data;
  }

  async getOrRefreshCache(sessionId: string, graphId: string) {
    const cache = await this.getCache(sessionId, graphId);

    if (cache) return cache;

    return this.refreshCache(sessionId, graphId);
  }

  async runGraph(sessionId: string, graphId: string) {
    await this.getOrRefreshCache(sessionId, graphId);
    this.sseService!.sendMessage(`graph:${graphId}`, true);
  }
}
