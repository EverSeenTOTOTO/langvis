import { NodeMetaEntity, NodeMetaName } from '@/shared/entities/NodeMeta';
import { inject, singleton } from 'tsyringe';
import { DataSource } from 'typeorm';
import { pgInjectToken } from './pg';

@singleton()
export class NodeMetaService {
  constructor(@inject(pgInjectToken) private pg?: DataSource) {}

  async createNodeMeta(data: NodeMetaEntity) {
    const repo = this.pg!.getRepository(NodeMetaEntity);
    const nodeMeta = repo.create(data);
    return await repo.save(nodeMeta);
  }

  async getAllNodeMeta() {
    const repo = this.pg!.getRepository(NodeMetaEntity);
    return await repo.find();
  }

  async getByCategory(category: string) {
    const all = await this.getAllNodeMeta();

    return all.filter(item => {
      return item.supportCategories.includes(category);
    });
  }

  async updateNodeMeta(name: string, data: Partial<NodeMetaEntity>) {
    const repo = this.pg!.getRepository(NodeMetaEntity);
    const existing = await repo.findOneBy({ name: name as NodeMetaName });
    if (!existing) {
      throw new Error(`NodeMeta with NAME ${name} not found`);
    }

    return await repo.save({
      ...existing,
      ...data,
      id: name,
    });
  }

  deleteNodeMeta(name: string) {
    const repo = this.pg!.getRepository(NodeMetaEntity);
    return repo.delete(name);
  }
}
