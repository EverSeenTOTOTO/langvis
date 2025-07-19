import { ExecuteService } from '@/server/service/ExecuteService';
import { container } from 'tsyringe';
import { GraphService } from '@/server/service/GraphService';
import { SSEService } from '@/server/service/SSEService';
import { vi } from 'vitest';

vi.mock('@/server/service/GraphService');
vi.mock('@/server/service/SSEService');

describe('ExecuteService', () => {
  let executeService: ExecuteService;
  let mockGraphService: GraphService;
  let mockSSEService: SSEService;

  beforeEach(() => {
    mockGraphService = new (GraphService as any)();
    mockSSEService = new (SSEService as any)();
    container.register(GraphService, { useValue: mockGraphService });
    container.register(SSEService, { useValue: mockSSEService });
    executeService = container.resolve(ExecuteService);
  });

  afterEach(() => {
    container.clearInstances();
  });

  it('should be defined', () => {
    expect(executeService).toBeDefined();
  });

  describe('runGraph', () => {
    it('should run a graph and send a message', async () => {
      const graphId = 'test_graph_id';
      const graphDetail = { id: graphId, name: 'Test Graph' };
      vi.spyOn(mockGraphService, 'findDetailById').mockResolvedValue(
        graphDetail as any,
      );
      mockSSEService.sendMessage = vi.fn();
      await executeService.runGraph(graphId);
      expect(mockGraphService.findDetailById).toHaveBeenCalledWith(graphId);
      expect(mockSSEService.sendMessage).toHaveBeenCalled();
    });
  });
});
