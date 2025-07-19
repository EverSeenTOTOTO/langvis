import { EdgeService } from '@/server/service/EdgeService';
import { container } from 'tsyringe';
import { DataSource } from 'typeorm';
import { NodeService } from '@/server/service/NodeService';
import { InjectTokens } from '@/server/utils';
import { vi } from 'vitest';

vi.mock('@/server/service/NodeService');

describe('EdgeService', () => {
  let edgeService: EdgeService;
  let mockDataSource: DataSource;
  let mockNodeService: NodeService;

  beforeEach(() => {
    mockDataSource = { getRepository: vi.fn() } as any;
    mockNodeService = new (NodeService as any)();
    container.register(InjectTokens.PG, { useValue: mockDataSource });
    container.register(InjectTokens.NODE_SERVICE, {
      useValue: mockNodeService,
    });
    edgeService = container.resolve(EdgeService);
  });

  afterEach(() => {
    container.clearInstances();
  });

  it('should be defined', () => {
    expect(edgeService).toBeDefined();
  });

  describe('create', () => {
    it('should create an edge', async () => {
      const edge = {
        id: '1',
        source: '1',
        target: '2',
        type: 'bezier',
        data: { graphId: '1' },
      };
      const expected = {
        ...edge,
        data: {
          ...edge.data,
          state: 'idle',
        },
      };
      const repository = {
        save: vi.fn().mockResolvedValue(edge),
        findOne: vi.fn().mockResolvedValue(null),
      };
      (mockDataSource.getRepository as any).mockReturnValue(repository);
      vi.spyOn(edgeService, 'findBySourceAndTarget').mockResolvedValue(null);

      const result = await edgeService.create(edge as any);

      expect(result).toEqual(expected);
      expect(repository.save).toHaveBeenCalledWith({
        ...edge,
        graphId: edge.data.graphId,
      });
    });

    it('should throw an error if edge already exists', async () => {
      const edge = {
        id: '1',
        source: '1',
        target: '2',
        type: 'bezier',
        data: { graphId: '1' },
      };
      vi.spyOn(edgeService, 'findBySourceAndTarget').mockResolvedValue(
        edge as any,
      );
      vi.spyOn(mockNodeService, 'findById').mockResolvedValue({
        data: { name: 'test' },
      } as any);

      await expect(edgeService.create(edge as any)).rejects.toThrow(
        'Edge with <test.source> and <test.target> already exists',
      );
    });
  });

  describe('delete', () => {
    it('should delete an edge', async () => {
      const repository = {
        delete: vi.fn(),
      };
      (mockDataSource.getRepository as any).mockReturnValue(repository);

      await edgeService.delete('1');

      expect(repository.delete).toHaveBeenCalledWith('1');
    });
  });

  describe('update', () => {
    it('should update an edge', async () => {
      const edge = {
        id: '1',
        source: '1',
        target: '2',
        type: 'bezier',
        data: { graphId: '1' },
      };
      const expected = {
        ...edge,
        data: {
          ...edge.data,
          state: 'idle',
        },
      };
      const repository = {
        save: vi.fn().mockResolvedValue(edge),
      };
      (mockDataSource.getRepository as any).mockReturnValue(repository);

      const result = await edgeService.update(edge as any);

      expect(result).toEqual(expected);
      expect(repository.save).toHaveBeenCalledWith({
        ...edge,
        graphId: edge.data.graphId,
      });
    });
  });

  describe('find', () => {
    it('should find an edge by id', async () => {
      const edge = {
        id: '1',
        source: '1',
        target: '2',
        type: 'bezier',
        data: { graphId: '1' },
      };
      const expected = {
        ...edge,
        data: {
          ...edge.data,
          state: 'idle',
        },
      };
      const repository = {
        findOneBy: vi.fn().mockResolvedValue(edge),
      };
      (mockDataSource.getRepository as any).mockReturnValue(repository);

      const result = await edgeService.findById('1');

      expect(result).toEqual(expected);
      expect(repository.findOneBy).toHaveBeenCalledWith({ id: '1' });
    });

    it('should throw an error if edge not found', async () => {
      const repository = {
        findOneBy: vi.fn().mockResolvedValue(null),
      };
      (mockDataSource.getRepository as any).mockReturnValue(repository);

      await expect(edgeService.findById('1')).rejects.toThrow(
        'Edge with id 1 not found',
      );
    });

    it('should find edges by graph id', async () => {
      const edge = {
        id: '1',
        source: '1',
        target: '2',
        type: 'bezier',
        data: { graphId: '1' },
      };
      const expected = {
        ...edge,
        data: {
          ...edge.data,
          state: 'idle',
        },
      };
      const repository = {
        findBy: vi.fn().mockResolvedValue([edge]),
      };
      (mockDataSource.getRepository as any).mockReturnValue(repository);

      const result = await edgeService.findByGraphId('1');

      expect(result).toEqual([expected]);
      expect(repository.findBy).toHaveBeenCalledWith({ graphId: '1' });
    });

    it('should find edges by node id', async () => {
      const edge = {
        id: '1',
        source: '1',
        target: '2',
        type: 'bezier',
        data: { graphId: '1' },
      };
      const expected = {
        ...edge,
        data: {
          ...edge.data,
          state: 'idle',
        },
      };
      const repository = {
        createQueryBuilder: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orWhere: vi.fn().mockReturnThis(),
        getMany: vi.fn().mockResolvedValue([edge]),
      };
      (mockDataSource.getRepository as any).mockReturnValue(repository);

      const result = await edgeService.findByNodeId('1');

      expect(result).toEqual([expected]);
    });

    it('should find edges by source node id', async () => {
      const edge = {
        id: '1',
        source: '1',
        target: '2',
        type: 'bezier',
        data: { graphId: '1' },
      };
      const expected = {
        ...edge,
        data: {
          ...edge.data,
          state: 'idle',
        },
      };
      const repository = {
        createQueryBuilder: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getMany: vi.fn().mockResolvedValue([edge]),
      };
      (mockDataSource.getRepository as any).mockReturnValue(repository);

      const result = await edgeService.findBySourceNodeId('1');

      expect(result).toEqual([expected]);
    });

    it('should find edges by target node id', async () => {
      const edge = {
        id: '1',
        source: '1',
        target: '2',
        type: 'bezier',
        data: { graphId: '1' },
      };
      const expected = {
        ...edge,
        data: {
          ...edge.data,
          state: 'idle',
        },
      };
      const repository = {
        createQueryBuilder: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getMany: vi.fn().mockResolvedValue([edge]),
      };
      (mockDataSource.getRepository as any).mockReturnValue(repository);

      const result = await edgeService.findByTargetNodeId('2');

      expect(result).toEqual([expected]);
    });

    it('should find an edge by source and target', async () => {
      const edge = {
        id: '1',
        source: '1',
        target: '2',
        type: 'bezier',
        data: { graphId: '1' },
      };
      const expected = {
        ...edge,
        data: {
          ...edge.data,
          state: 'idle',
        },
      };
      const repository = {
        createQueryBuilder: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue(edge),
      };
      (mockDataSource.getRepository as any).mockReturnValue(repository);

      const result = await edgeService.findBySourceAndTarget('1', '2');

      expect(result).toEqual(expected);
    });
  });
});
