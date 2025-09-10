import { describe, it, expect, beforeEach, vi } from 'vitest';
import AgentService from '../../../src/server/service/AgentService';

// Mock the glob import
vi.mock('import.meta.glob', () => ({
  default: vi.fn(),
}));

describe('AgentService', () => {
  beforeEach(() => {
    // Reset the service state before each test
    const service = new (AgentService.constructor as any)();
    Object.assign(AgentService, service);
  });

  it('should get all agents', async () => {
    const agents = await AgentService.getAllAgents();
    expect(Array.isArray(agents)).toBe(true);
    // We expect at least the three agents we know exist
    expect(agents.length).toBeGreaterThanOrEqual(3);
  });

  it('should get an agent by name', async () => {
    const agent = await AgentService.getAgentByName('DateTime Tool');
    expect(agent).toBeDefined();
    expect(agent?.name).toBe('DateTime Tool');
    expect(agent?.description).toBeDefined();
  });

  it('should return undefined for non-existent agent', async () => {
    const agent = await AgentService.getAgentByName('NonExistentAgent');
    expect(agent).toBeUndefined();
  });
});
