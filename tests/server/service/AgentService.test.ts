import { container } from 'tsyringe';
import { AgentService } from '@/server/modules/agent/application/service/agent.service';
import { SkillService } from '@/server/modules/agent/application/service/skill.service';
import { ToolService } from '@/server/modules/agent/application/service/tool.service';
import { CACHE_SERVICE } from '@/server/modules/agent/agent.di-tokens';
import { MEMORY_SERVICE } from '@/server/modules/memory/memory.di-tokens';
import { LlmProvider } from '@/server/modules/memory/infrastructure/llm.provider';
import { ProviderService } from '@/server/libs/infrastructure/provider.service';
import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest';
import { globby } from 'globby';
import * as configModule from '@/server/decorator/core';

vi.mock('globby');
vi.mock('@/server/modules/agent/application/service/tool.service');
vi.mock('@/server/modules/agent/application/service/skill.service');
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
  let mockSkillService: any;

  beforeEach(() => {
    vi.clearAllMocks();
    container.clearInstances();

    mockToolService = {
      initialize: vi.fn().mockResolvedValue(undefined),
      getAllToolInfo: vi.fn().mockResolvedValue([]),
    };
    mockSkillService = {
      initialize: vi.fn().mockResolvedValue(undefined),
    };
    container.register(ToolService, { useValue: mockToolService });
    container.register(SkillService, { useValue: mockSkillService });

    // Register port dependencies
    container.register(MEMORY_SERVICE, {
      useValue: { summarize: vi.fn(), estimateUsage: vi.fn() },
    });
    container.register(CACHE_SERVICE, {
      useValue: { resolve: vi.fn(), compress: vi.fn(), readFile: vi.fn() },
    });

    container.registerInstance(LlmProvider as any, {} as any);

    container.registerInstance(
      ProviderService as any,
      {
        getDefaultModel: vi.fn(),
        getModel: vi.fn(),
      } as any,
    );
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
      vi.mocked(configModule.registerAgent).mockImplementation(async token => {
        // @ts-expect-error tsyringe register signature mismatch
        container.register(token, { useValue: { config: mockConfig } });
        return token;
      });

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
      vi.mocked(configModule.registerAgent).mockImplementation(async token => {
        // @ts-expect-error tsyringe register signature mismatch
        container.register(token, { useValue: { config: mockConfig } });
        return token;
      });

      agentService = container.resolve(AgentService);
      const result = await agentService.getAllAgentInfo();

      expect(globby).toHaveBeenCalledWith(
        expect.stringContaining(
          'server/modules/agent/implementations/agents/*/index',
        ),
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
