import { EdgeEntity } from '@/shared/entities/Edge';
import { NodeEntity } from '@/shared/entities/Node';
import { NodeMetaName } from '@/shared/entities/NodeMeta';
import { ClientNode, InstrinicNode, Slot } from '@/shared/types';
import { flatten } from 'lodash-es';
import { inject, singleton } from 'tsyringe';
import { DataSource } from 'typeorm';
import { Button } from '../core/nodes/Button';
import type { EdgeService } from './EdgeService';
import { InjectTokens } from '../utils';

@singleton()
export class NodeService {
  constructor(
    @inject(InjectTokens.PG) private pg?: DataSource,
    @inject(InjectTokens.EDGE_SERVICE) private edgeService?: EdgeService,
  ) {}

  async create(node: ClientNode) {
    const entity = this.toDatabase(node);
    const result = await this.pg!.getRepository(NodeEntity).save(entity);

    return this.toClient(result);
  }

  delete(id: string) {
    return this.pg!.transaction(async transactionalEntityManager => {
      const result = await transactionalEntityManager
        .getRepository(NodeEntity)
        .delete(id);

      await transactionalEntityManager
        .createQueryBuilder()
        .delete()
        .from(EdgeEntity)
        .where('source = :id', { id })
        .orWhere('target = :id', { id })
        .execute();

      return result;
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

      const deletedSlots =
        old!.data?.slots?.filter((slot: Slot) => {
          return !newNode!.data?.slots?.some((h: Slot) => h.type === slot.type);
        }) || [];

      if (deletedSlots.length > 0) {
        const edges = await Promise.all(
          deletedSlots.map((slot: Slot) => {
            if (slot.type === 'source') {
              return this.edgeService!.findBySourceNodeId(node.id);
            }

            if (slot.type === 'target') {
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
