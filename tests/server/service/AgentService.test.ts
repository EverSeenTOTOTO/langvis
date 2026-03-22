import { container } from 'tsyringe';
import { AgentService } from '@/server/service/AgentService';
import { ToolService } from '@/server/service/ToolService';
import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest';
import { globby } from 'globby';
import * as configModule from '@/server/decorator/core';

vi.mock('globby');
vi.mock('@/server/service/ToolService');
vi.mock('@/server/decorator/core', async importOriginal => {
  const actual = await importOriginal<typeof configModule>();
  return {
    ...actual,
    registerAgent: vi.fn(),
  };
});

describe('AgentService', () => {
  let agentService: AgentService;
  let mockToolService: any;

  beforeEach(() => {
    vi.clearAllMocks();
    container.clearInstances();

    mockToolService = {
      getAllToolInfo: vi.fn().mockResolvedValue([]),
    };
    container.register(ToolService, { useValue: mockToolService });
  });

  afterEach(() => {
    container.clearInstances();
  });

  describe('initialization', () => {
    it('should initialize tools before agents', async () => {
      const mockAgentPath = '/path/to/agent/index.ts';
      const mockConfig = { name: { en: 'Test Agent', zh: '测试代理' } };
      const mockAgentClass = class TestAgent {};

      vi.mocked(globby).mockResolvedValue([mockAgentPath]);
      vi.doMock(mockAgentPath, () => ({ default: mockAgentClass }));
      vi.doMock('/path/to/agent/config.ts', () => ({ config: mockConfig }));
      vi.mocked(configModule.registerAgent).mockResolvedValue('test-agent');

      agentService = container.resolve(AgentService);
      await agentService.getAllAgentInfo();

      expect(mockToolService.getAllToolInfo).toHaveBeenCalled();
    });

    it('should discover and register agents', async () => {
      const mockAgentPath = '/path/to/agent/index.ts';
      const mockConfig = { name: { en: 'Test Agent', zh: '测试代理' } };
      const mockAgentClass = class TestAgent {};

      vi.mocked(globby).mockResolvedValue([mockAgentPath]);
      vi.doMock(mockAgentPath, () => ({ default: mockAgentClass }));
      vi.doMock('/path/to/agent/config.ts', () => ({ config: mockConfig }));
      vi.mocked(configModule.registerAgent).mockResolvedValue('test-agent');

      agentService = container.resolve(AgentService);
      const result = await agentService.getAllAgentInfo();

      expect(globby).toHaveBeenCalledWith(
        expect.stringContaining('server/core/agent/*/index'),
        expect.any(Object),
      );
      expect(result).toBeDefined();
    });

    it('should handle empty agent discovery', async () => {
      vi.mocked(globby).mockResolvedValue([]);
      vi.mocked(configModule.registerAgent).mockResolvedValue('test-agent');

      agentService = container.resolve(AgentService);
      const result = await agentService.getAllAgentInfo();

      expect(result).toEqual([]);
    });

    it('should handle initialization errors gracefully', async () => {
      mockToolService.getAllToolInfo.mockRejectedValue(
        new Error('Tool initialization failed'),
      );

      agentService = container.resolve(AgentService);
      const result = await agentService.getAllAgentInfo();

      expect(result).toEqual([]);
    });

    it('should initialize only once', async () => {
      vi.mocked(globby).mockResolvedValue([]);

      agentService = container.resolve(AgentService);
      await agentService.getAllAgentInfo();
      await agentService.getAllAgentInfo();

      expect(mockToolService.getAllToolInfo).toHaveBeenCalledTimes(1);
      expect(globby).toHaveBeenCalledTimes(1);
    });
  });

  describe('injectAgents', () => {
    it('should inject agents into agent with agents config', async () => {
      const parentAgent = {
        config: {
          name: 'Parent Agent',
          agents: ['child-agent-1', 'child-agent-2'],
        },
        agents: [],
      };
      const childAgent1 = { config: { name: 'Child Agent 1' } };
      const childAgent2 = { config: { name: 'Child Agent 2' } };

      vi.mocked(globby).mockResolvedValue([]);
      agentService = container.resolve(AgentService);

      vi.spyOn(agentService as any, 'agents', 'get').mockReturnValue([
        'parent-agent',
      ]);
      container.register('parent-agent', { useValue: parentAgent });
      container.register('child-agent-1', { useValue: childAgent1 });
      container.register('child-agent-2', { useValue: childAgent2 });

      await (agentService as any).injectAgents();

      expect(parentAgent.agents).toHaveLength(2);
      expect(parentAgent.agents).toContain(childAgent1);
      expect(parentAgent.agents).toContain(childAgent2);
    });

    it('should skip agent without agents config', async () => {
      const agentWithoutAgents = {
        config: { name: 'Simple Agent' },
      };

      vi.mocked(globby).mockResolvedValue([]);
      agentService = container.resolve(AgentService);

      vi.spyOn(agentService as any, 'agents', 'get').mockReturnValue([
        'simple-agent',
      ]);
      container.register('simple-agent', { useValue: agentWithoutAgents });

      await (agentService as any).injectAgents();

      expect(agentWithoutAgents).not.toHaveProperty('agents');
    });

    it('should warn and skip when dependent agent not found', async () => {
      const parentAgent = {
        config: {
          name: 'Parent Agent',
          agents: ['non-existent-agent'],
        },
        agents: [],
      };

      vi.mocked(globby).mockResolvedValue([]);
      agentService = container.resolve(AgentService);

      vi.spyOn(agentService as any, 'agents', 'get').mockReturnValue([
        'parent-agent',
      ]);
      container.register('parent-agent', { useValue: parentAgent });

      const loggerSpy = vi.spyOn((agentService as any).logger, 'warn');

      await (agentService as any).injectAgents();

      expect(loggerSpy).toHaveBeenCalledWith(
        'Agent not found: non-existent-agent',
      );
      expect(parentAgent.agents).toHaveLength(0);
    });

    it('should handle empty agents list', async () => {
      vi.mocked(globby).mockResolvedValue([]);
      agentService = container.resolve(AgentService);

      vi.spyOn(agentService as any, 'agents', 'get').mockReturnValue([]);

      expect(() => (agentService as any).injectAgents()).not.toThrow();
    });
  });

  describe('getAllAgentInfo', () => {
    it('should return agent info with config', async () => {
      const mockAgent = {
        id: 'test-agent',
        config: {
          name: { en: 'Test Agent', zh: '测试代理' },
          description: { en: 'Test description', zh: '测试描述' },
        },
      };

      vi.mocked(globby).mockResolvedValue([]);
      agentService = container.resolve(AgentService);

      vi.spyOn(agentService as any, 'agents', 'get').mockReturnValue([
        'test-agent',
      ]);
      container.register('test-agent', { useValue: mockAgent });

      const result = await agentService.getAllAgentInfo();

      expect(result).toEqual([
        {
          id: 'test-agent',
          name: { en: 'Test Agent', zh: '测试代理' },
          description: { en: 'Test description', zh: '测试描述' },
        },
      ]);
    });
  });
});
