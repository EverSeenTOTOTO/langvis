import { EdgeEntity } from '@/shared/entities/Edge';
import { NodeEntity } from '@/shared/entities/Node';
import { NodeMetaName } from '@/shared/entities/NodeMeta';
import { ClientNode, InstrinicNode } from '@/shared/types';
import { inject, singleton } from 'tsyringe';
import { DataSource } from 'typeorm';
import { Button } from '../core/nodes/Button';
import { pgInjectToken } from './pg';
import { EdgeService } from './EdgeService';
import { Handle } from '@xyflow/react';
import { flatten } from 'lodash-es';

@singleton()
export class NodeService {
  constructor(
    @inject(pgInjectToken) private pg?: DataSource,
    @inject(EdgeService) private edgeService?: EdgeService,
  ) {}

  async create(node: ClientNode) {
    const entity: Omit<NodeEntity, 'id' | 'graph'> = {
      graphId: node.data?.graphId,
      type: node.type!,
      name: node.data?.name,
      description: node.data?.description,
      position: node.position,
      data: node.data,
    };

    await this.pg!.getRepository(NodeEntity).save(entity);

    return this.findById(node.id);
  }

  delete(id: string) {
    return this.pg!.transaction(async transactionalEntityManager => {
      await transactionalEntityManager.getRepository(NodeEntity).delete(id);
      return transactionalEntityManager
        .createQueryBuilder()
        .delete()
        .from(EdgeEntity)
        .where('source = :id', { id })
        .orWhere('target = :id', { id })
        .execute();
    });
  }

  async update(node: ClientNode) {
    const old = await this.findById(node.id)!;

    return this.pg!.transaction(async transactionalEntityManager => {
      await transactionalEntityManager
        .createQueryBuilder()
        .update(NodeEntity)
        .set(this.toDatabase(node))
        .where('id = :id', { id: node.id })
        .execute();

      const newNode = await transactionalEntityManager
        .getRepository(NodeEntity)
        .findOne({ where: { id: node.id } });

      const deletedHandles = old!.data?.handles?.filter((handle: Handle) => {
        return !newNode!.data?.handles?.some(
          (h: Handle) => h.type === handle.type,
        );
      });

      if (deletedHandles.length > 0) {
        const edges = await Promise.all(
          deletedHandles.map((handle: Handle) => {
            if (handle.type === 'source') {
              return this.edgeService!.findBySourceNodeId(node.id);
            }

            if (handle.type === 'target') {
              return this.edgeService!.findByTargetNodeId(node.id);
            }

            return [];
          }),
        );
        const edgeIds = flatten(edges).map(e => e.id);

        await transactionalEntityManager
          .createQueryBuilder()
          .delete()
          .from(EdgeEntity)
          .where('id IN (:...ids)', { ids: edgeIds })
          .execute();
      }

      return this.toClient(newNode!);
    });
  }

  async findById(id: string) {
    const node = await this.pg!.getRepository(NodeEntity).findOne({
      where: { id },
    });

    return this.toClient(node!);
  }

  async findByGraphId(graphId: string) {
    const nodes = await this.pg!.getRepository(NodeEntity).findBy({
      graphId,
    });

    return nodes.map(node => this.toClient(node));
  }

  toClient(node: NodeEntity) {
    switch (node.type) {
      case NodeMetaName.BUTTON:
        return Button.toClient(node);
      default:
        throw new Error(
          `Failed to convert client node: not implemented. Node type: ${node.type}`,
        );
    }
  }

  toDatabase(node: ClientNode) {
    switch (node.type) {
      case NodeMetaName.BUTTON:
        return Button.toDatabase(node as InstrinicNode['button']);
      default:
        throw new Error(
          `Failed to convert database node: not implemented. Node type: ${node.type}`,
        );
    }
  }
}
