import { describe, it, expect, vi, beforeEach } from 'vitest';
import { container } from 'tsyringe';
import { AgentStore } from '@/client/store/modules/agent';

describe('AgentStore', () => {
  let agentStore: AgentStore;

  beforeEach(() => {
    vi.clearAllMocks();
    container.clearInstances();
    agentStore = container.resolve(AgentStore);
  });

  describe('getAllAgent', () => {
    it('should send API request', () => {
      const mockReq = {
        send: vi.fn().mockResolvedValue({ data: [] }),
      };

      const result = agentStore.getAllAgent(undefined, mockReq as any);

      expect(mockReq.send).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('should handle params', () => {
      const mockReq = {
        send: vi.fn().mockResolvedValue({ data: [] }),
      };

      const params = { filter: 'active' };
      agentStore.getAllAgent(params, mockReq as any);

      expect(mockReq.send).toHaveBeenCalled();
    });
  });
});
