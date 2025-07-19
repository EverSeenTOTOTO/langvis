import { NodeMetaService } from '@/server/service/NodeMetaService';
import { container } from 'tsyringe';
import { DataSource } from 'typeorm';
import { InjectTokens } from '@/server/utils';
import { vi } from 'vitest';

vi.mock('@/server/service/pg');

describe('NodeMetaService', () => {
  let nodeMetaService: NodeMetaService;
  let mockDataSource: DataSource;

  beforeEach(() => {
    mockDataSource = { getRepository: vi.fn() } as any;
    container.register(InjectTokens.PG, { useValue: mockDataSource });
    nodeMetaService = container.resolve(NodeMetaService);
  });

  afterEach(() => {
    container.clearInstances();
  });

  it('should be defined', () => {
    expect(nodeMetaService).toBeDefined();
  });

  describe('createNodeMeta', () => {
    it('should create a node meta', async () => {
      const nodeMeta = { name: 'test', supportCategories: [] };
      const repository = {
        create: vi.fn().mockReturnValue(nodeMeta),
        save: vi.fn().mockResolvedValue(nodeMeta),
      };
      (mockDataSource.getRepository as any).mockReturnValue(repository);

      const result = await nodeMetaService.createNodeMeta(nodeMeta as any);

      expect(result).toEqual(nodeMeta);
      expect(repository.create).toHaveBeenCalledWith(nodeMeta);
      expect(repository.save).toHaveBeenCalledWith(nodeMeta);
    });
  });

  describe('getAllNodeMeta', () => {
    it('should get all node metas', async () => {
      const nodeMetas = [{ name: 'test', supportCategories: [] }];
      const repository = {
        find: vi.fn().mockResolvedValue(nodeMetas),
      };
      (mockDataSource.getRepository as any).mockReturnValue(repository);

      const result = await nodeMetaService.getAllNodeMeta();

      expect(result).toEqual(nodeMetas);
      expect(repository.find).toHaveBeenCalled();
    });
  });

  describe('getByCategory', () => {
    it('should get node metas by category', async () => {
      const nodeMetas = [
        { name: 'test1', supportCategories: ['cat1'] },
        { name: 'test2', supportCategories: ['cat2'] },
      ];
      vi.spyOn(nodeMetaService, 'getAllNodeMeta').mockResolvedValue(
        nodeMetas as any,
      );

      const result = await nodeMetaService.getByCategory('cat1');

      expect(result).toEqual([nodeMetas[0]]);
    });
  });

  describe('updateNodeMeta', () => {
    it('should update a node meta', async () => {
      const nodeMeta = { name: 'test', supportCategories: [] };
      const repository = {
        findOneBy: vi.fn().mockResolvedValue(nodeMeta),
        save: vi.fn().mockResolvedValue(nodeMeta),
      };
      (mockDataSource.getRepository as any).mockReturnValue(repository);

      const result = await nodeMetaService.updateNodeMeta('test', {});

      expect(result).toEqual(nodeMeta);
      expect(repository.save).toHaveBeenCalledWith({
        ...nodeMeta,
        id: 'test',
      });
    });

    it('should throw an error if node meta not found', async () => {
      const repository = {
        findOneBy: vi.fn().mockResolvedValue(null),
      };
      (mockDataSource.getRepository as any).mockReturnValue(repository);

      await expect(nodeMetaService.updateNodeMeta('test', {})).rejects.toThrow(
        'NodeMeta with NAME test not found',
      );
    });
  });

  describe('deleteNodeMeta', () => {
    it('should delete a node meta', async () => {
      const repository = {
        delete: vi.fn(),
      };
      (mockDataSource.getRepository as any).mockReturnValue(repository);

      await nodeMetaService.deleteNodeMeta('test');

      expect(repository.delete).toHaveBeenCalledWith('test');
    });
  });
});
