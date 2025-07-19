import { NodeService } from '@/server/service/NodeService';
import { container } from 'tsyringe';
import { DataSource } from 'typeorm';
import { EdgeService } from '@/server/service/EdgeService';
import { InjectTokens } from '@/server/utils';
import { vi } from 'vitest';

vi.mock('@/server/service/EdgeService');

describe('NodeService', () => {
  let nodeService: NodeService;
  let mockDataSource: DataSource;
  let mockEdgeService: EdgeService;

  beforeEach(() => {
    mockDataSource = { getRepository: vi.fn(), transaction: vi.fn() } as any;
    mockEdgeService = new (EdgeService as any)();
    container.register(InjectTokens.PG, { useValue: mockDataSource });
    container.register(InjectTokens.EDGE_SERVICE, {
      useValue: mockEdgeService,
    });
    nodeService = container.resolve(NodeService);
  });

  afterEach(() => {
    container.clearInstances();
  });

  it('should be defined', () => {
    expect(nodeService).toBeDefined();
  });

  describe('create', () => {
    it('should create a node', async () => {
      const node = {
        id: '1',
        type: 'button',
        data: {},
        position: { x: 0, y: 0 },
      };
      const expected = {
        ...node,
        data: {
          ...node.data,
          state: 'idle',
          slots: [],
        },
      };
      const repository = {
        save: vi.fn().mockResolvedValue(node),
      };
      (mockDataSource.getRepository as any).mockReturnValue(repository);

      const result = await nodeService.create(node as any);

      expect(result).toEqual(expected);
      expect(repository.save).toHaveBeenCalledWith(node);
    });
  });

  describe('delete', () => {
    it('should delete a node and its edges', async () => {
      const repository = {
        delete: vi.fn(),
      };
      const queryBuilder = {
        delete: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orWhere: vi.fn().mockReturnThis(),
        execute: vi.fn(),
      };
      (mockDataSource.getRepository as any).mockReturnValue(repository);
      (mockDataSource.transaction as any).mockImplementation(
        async (cb: any) => {
          const transactionalEntityManager = {
            getRepository: vi.fn().mockReturnValue(repository),
            createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
          };
          return await cb(transactionalEntityManager);
        },
      );

      await nodeService.delete('1');

      expect(repository.delete).toHaveBeenCalledWith('1');
      expect(queryBuilder.execute).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should update a node', async () => {
      const node = {
        id: '1',
        type: 'button',
        data: { slots: [] },
        position: { x: 0, y: 0 },
      };
      const expected = {
        ...node,
        data: {
          ...node.data,
          state: 'idle',
        },
      };
      const repository = {
        findOne: vi.fn().mockResolvedValue(node),
      };
      const queryBuilder = {
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        execute: vi.fn(),
      };
      (mockDataSource.getRepository as any).mockReturnValue(repository);
      (mockDataSource.transaction as any).mockImplementation(
        async (cb: any) => {
          const transactionalEntityManager = {
            getRepository: vi.fn().mockReturnValue(repository),
            createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
          };
          return await cb(transactionalEntityManager);
        },
      );
      vi.spyOn(nodeService, 'findById').mockResolvedValue(node as any);

      const result = await nodeService.update(node as any);

      expect(result).toEqual(expected);
      expect(queryBuilder.execute).toHaveBeenCalled();
    });

    it('should remove related edges when a source slot is removed', async () => {
      const oldNode = {
        id: '1',
        type: 'button',
        data: { slots: [{ type: 'source' }] },
        position: { x: 0, y: 0 },
      };
      const newNode = {
        id: '1',
        type: 'button',
        data: { slots: [] },
        position: { x: 0, y: 0 },
      };
      const repository = {
        findOne: vi.fn().mockResolvedValue(newNode),
      };
      const queryBuilder = {
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        execute: vi.fn(),
        delete: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
      };
      (mockDataSource.getRepository as any).mockReturnValue(repository);
      (mockDataSource.transaction as any).mockImplementation(
        async (cb: any) => {
          const transactionalEntityManager = {
            getRepository: vi.fn().mockReturnValue(repository),
            createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
          };
          return await cb(transactionalEntityManager);
        },
      );
      vi.spyOn(nodeService, 'findById').mockResolvedValue(oldNode as any);
      vi.spyOn(mockEdgeService, 'findBySourceNodeId').mockResolvedValue([
        { id: 'edge1' },
      ] as any);

      await nodeService.update(newNode as any);

      expect(queryBuilder.delete).toHaveBeenCalled();
    });

    it('should remove related edges when a target slot is removed', async () => {
      const oldNode = {
        id: '1',
        type: 'button',
        data: { slots: [{ type: 'target' }] },
        position: { x: 0, y: 0 },
      };
      const newNode = {
        id: '1',
        type: 'button',
        data: { slots: [] },
        position: { x: 0, y: 0 },
      };
      const repository = {
        findOne: vi.fn().mockResolvedValue(newNode),
      };
      const queryBuilder = {
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        execute: vi.fn(),
        delete: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
      };
      (mockDataSource.getRepository as any).mockReturnValue(repository);
      (mockDataSource.transaction as any).mockImplementation(
        async (cb: any) => {
          const transactionalEntityManager = {
            getRepository: vi.fn().mockReturnValue(repository),
            createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
          };
          return await cb(transactionalEntityManager);
        },
      );
      vi.spyOn(nodeService, 'findById').mockResolvedValue(oldNode as any);
      vi.spyOn(mockEdgeService, 'findByTargetNodeId').mockResolvedValue([
        { id: 'edge1' },
      ] as any);

      await nodeService.update(newNode as any);

      expect(queryBuilder.delete).toHaveBeenCalled();
    });
  });

  describe('find', () => {
    it('should find a node by id', async () => {
      const node = {
        id: '1',
        type: 'button',
        data: {},
        position: { x: 0, y: 0 },
      };
      const expected = {
        ...node,
        data: {
          ...node.data,
          state: 'idle',
          slots: [],
        },
      };
      const repository = {
        findOne: vi.fn().mockResolvedValue(node),
      };
      (mockDataSource.getRepository as any).mockReturnValue(repository);

      const result = await nodeService.findById('1');

      expect(result).toEqual(expected);
      expect(repository.findOne).toHaveBeenCalledWith({ where: { id: '1' } });
    });

    it('should find nodes by graph id', async () => {
      const nodes = [
        { id: '1', type: 'button', data: {}, position: { x: 0, y: 0 } },
      ];
      const expected = [
        {
          ...nodes[0],
          data: {
            ...nodes[0].data,
            state: 'idle',
            slots: [],
          },
        },
      ];
      const repository = {
        findBy: vi.fn().mockResolvedValue(nodes),
      };
      (mockDataSource.getRepository as any).mockReturnValue(repository);

      const result = await nodeService.findByGraphId('1');

      expect(result).toEqual(expected);
      expect(repository.findBy).toHaveBeenCalledWith({ graphId: '1' });
    });
  });
});
