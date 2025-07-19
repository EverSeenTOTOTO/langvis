import { GraphService } from '@/server/service/GraphService';
import { container } from 'tsyringe';
import { DataSource } from 'typeorm';
import { NodeService } from '@/server/service/NodeService';
import { EdgeService } from '@/server/service/EdgeService';
import { InjectTokens } from '@/server/utils';
import { vi } from 'vitest';

vi.mock('@/server/service/NodeService');
vi.mock('@/server/service/EdgeService');

describe('GraphService', () => {
  let graphService: GraphService;
  let mockDataSource: DataSource;
  let mockNodeService: NodeService;
  let mockEdgeService: EdgeService;

  beforeEach(() => {
    mockDataSource = { getRepository: vi.fn() } as any;
    mockNodeService = new (NodeService as any)();
    mockEdgeService = new (EdgeService as any)();
    container.register(InjectTokens.PG, { useValue: mockDataSource });
    container.register(NodeService, { useValue: mockNodeService });
    container.register(EdgeService, { useValue: mockEdgeService });
    graphService = container.resolve(GraphService);
  });

  afterEach(() => {
    container.clearInstances();
  });

  it('should be defined', () => {
    expect(graphService).toBeDefined();
  });

  describe('create', () => {
    it('should create a graph', async () => {
      const graph = { id: '1', name: 'Test Graph' };
      const repository = {
        save: vi.fn().mockResolvedValue(graph),
      };
      (mockDataSource.getRepository as any).mockReturnValue(repository);

      const result = await graphService.create(graph as any);

      expect(result).toEqual(graph);
      expect(repository.save).toHaveBeenCalledWith(graph);
    });
  });

  describe('delete', () => {
    it('should delete a graph', async () => {
      const repository = {
        findOneBy: vi.fn().mockResolvedValue({ id: '1' }),
        delete: vi.fn(),
      };
      (mockDataSource.getRepository as any).mockReturnValue(repository);

      await graphService.delete('1');

      expect(repository.delete).toHaveBeenCalledWith('1');
    });

    it('should throw an error if graph not found', async () => {
      const repository = {
        findOneBy: vi.fn().mockResolvedValue(null),
      };
      (mockDataSource.getRepository as any).mockReturnValue(repository);

      await expect(graphService.delete('1')).rejects.toThrow(
        'Graph 1 not found',
      );
    });
  });

  describe('update', () => {
    it('should update a graph', async () => {
      const graph = { id: '1', name: 'Test Graph' };
      const repository = {
        findOneBy: vi.fn().mockResolvedValue(graph),
        save: vi.fn().mockResolvedValue(graph),
      };
      (mockDataSource.getRepository as any).mockReturnValue(repository);

      const result = await graphService.update(graph as any);

      expect(result).toEqual(graph);
      expect(repository.save).toHaveBeenCalledWith(graph);
    });

    it('should throw an error if graph not found', async () => {
      const graph = { id: '1', name: 'Test Graph' };
      const repository = {
        findOneBy: vi.fn().mockResolvedValue(null),
      };
      (mockDataSource.getRepository as any).mockReturnValue(repository);

      await expect(graphService.update(graph as any)).rejects.toThrow(
        'Graph 1 not found',
      );
    });
  });

  describe('find', () => {
    it('should find all graphs', async () => {
      const graphs = [{ id: '1', name: 'Test Graph' }];
      const repository = {
        find: vi.fn().mockResolvedValue(graphs),
      };
      (mockDataSource.getRepository as any).mockReturnValue(repository);

      const result = await graphService.findAll();

      expect(result).toEqual(graphs);
      expect(repository.find).toHaveBeenCalled();
    });

    it('should find a graph by id', async () => {
      const graph = { id: '1', name: 'Test Graph' };
      const repository = {
        findOneBy: vi.fn().mockResolvedValue(graph),
      };
      (mockDataSource.getRepository as any).mockReturnValue(repository);

      const result = await graphService.findById('1');

      expect(result).toEqual(graph);
      expect(repository.findOneBy).toHaveBeenCalledWith({ id: '1' });
    });

    it('should find a graph detail by id', async () => {
      const graph = { id: '1', name: 'Test Graph' };
      const nodes = [{ id: '1', type: 'test' }];
      const edges = [{ id: '1', source: '1', target: '2' }];
      const repository = {
        findOneBy: vi.fn().mockResolvedValue(graph),
      };
      (mockDataSource.getRepository as any).mockReturnValue(repository);
      vi.spyOn(mockNodeService, 'findByGraphId').mockResolvedValue(
        nodes as any,
      );
      vi.spyOn(mockEdgeService, 'findByGraphId').mockResolvedValue(
        edges as any,
      );

      const result = await graphService.findDetailById('1');

      expect(result).toEqual({ ...graph, nodes, edges });
      expect(repository.findOneBy).toHaveBeenCalledWith({ id: '1' });
      expect(mockNodeService.findByGraphId).toHaveBeenCalledWith('1');
      expect(mockEdgeService.findByGraphId).toHaveBeenCalledWith('1');
    });

    it('should throw an error if graph not found in findDetailById', async () => {
      const repository = {
        findOneBy: vi.fn().mockResolvedValue(null),
      };
      (mockDataSource.getRepository as any).mockReturnValue(repository);

      await expect(graphService.findDetailById('1')).rejects.toThrow(
        'Graph 1 not found',
      );
    });
  });
});
