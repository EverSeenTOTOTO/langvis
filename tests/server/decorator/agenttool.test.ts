import { Agent } from '@/server/core/agent';
import { Tool } from '@/server/core/tool';
import {
  agent,
  registerAgent,
  registerTool,
  tool,
} from '@/server/decorator/agenttool';
import { config, input } from '@/server/decorator/param';
import { AgentIds, ToolIds } from '@/shared/constants';
import { AgentConfig, ToolConfig } from '@/shared/types';
import { container } from 'tsyringe';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import winston from 'winston';

vi.mock('@/server/utils/logger', () => {
  const mockLogger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  };
  mockLogger.child.mockReturnValue(mockLogger);
  return {
    default: mockLogger,
  };
});

const mockWriter = {
  write: vi.fn(),
  abort: vi.fn(),
  close: vi.fn(),
};

describe('Config Decorators', () => {
  beforeEach(() => {
    container.clearInstances();
    vi.clearAllMocks();
  });

  describe('agent decorator', () => {
    it('should add metadata and make class injectable', () => {
      @agent(AgentIds.CHAT)
      class TestAgent extends Agent {
        id = AgentIds.CHAT;
        config: AgentConfig = {
          name: { en: 'Test Agent' },
          description: { en: 'Test description' },
        };
        logger = winston.createLogger();
      }

      // Check if the class can be resolved (injectable)
      expect(() => container.resolve(TestAgent)).not.toThrow();
    });
  });

  describe('tool decorator', () => {
    it('should add metadata and make class injectable', () => {
      @tool(ToolIds.DATE_TIME)
      class TestTool extends Tool {
        id = ToolIds.DATE_TIME;
        config: ToolConfig = {
          name: { en: 'Test Tool' },
          description: { en: 'Test description' },
        };
        logger = winston.createLogger();
      }

      // Check if the class can be resolved (injectable)
      expect(() => container.resolve(TestTool)).not.toThrow();
    });
  });

  describe('registerAgent', () => {
    it('should register agent with basic config', async () => {
      @agent(AgentIds.CHAT)
      class TestAgent extends Agent {
        id = AgentIds.CHAT;
        config: AgentConfig = {
          name: { en: 'Test Agent' },
          description: { en: 'Test description' },
        };
        logger = winston.createLogger();
      }

      const configData: AgentConfig = {
        name: { en: 'Test Agent' },
        description: { en: 'Test description' },
        enabled: true,
      };

      const token = await registerAgent(TestAgent, configData);

      expect(token).toBe(AgentIds.CHAT);

      // Should be able to resolve the agent
      const instance = container.resolve<Agent>(AgentIds.CHAT);
      expect(instance).toBeInstanceOf(TestAgent);
      expect(instance.config).toEqual(configData);
      expect(instance.id).toBe(AgentIds.CHAT);
    });

    it('should register agent with tools', async () => {
      @tool(ToolIds.DATE_TIME)
      class TestTool extends Tool {
        id = ToolIds.DATE_TIME;
        config: ToolConfig = {
          name: { en: 'Test Tool' },
          description: { en: 'Test description' },
        };
        logger = winston.createLogger();
      }

      @agent(AgentIds.CHAT)
      class TestAgent extends Agent {
        id = AgentIds.CHAT;
        config: AgentConfig = {
          name: { en: 'Test Agent' },
          description: { en: 'Test description' },
        };
        logger = winston.createLogger();
        tools: Tool[] = [];
      }

      // Register tool first
      const toolConfig: ToolConfig = {
        name: { en: 'Test Tool' },
        description: { en: 'Test description' },
      };
      await registerTool(TestTool, toolConfig);

      // Register agent with tool dependency
      const agentConfig: AgentConfig = {
        name: { en: 'Test Agent' },
        description: { en: 'Test description' },
        tools: [ToolIds.DATE_TIME],
      };

      const token = await registerAgent(TestAgent, agentConfig);

      expect(token).toBe(AgentIds.CHAT);

      // Check if tools are injected
      const instance = container.resolve<Agent>(AgentIds.CHAT) as TestAgent;
      expect(instance.tools).toHaveLength(1);
      expect(instance.tools[0]).toBeInstanceOf(TestTool);
    });

    it('should handle config extension', async () => {
      @agent(AgentIds.REACT)
      class BaseAgent extends Agent {
        id = AgentIds.REACT;
        config: AgentConfig = {
          name: { en: 'Base Agent' },
          description: { en: 'Base description' },
          enabled: true,
        };
        logger = winston.createLogger();
      }

      @agent(AgentIds.CHAT)
      class ExtendedAgent extends Agent {
        id = AgentIds.CHAT;
        config: AgentConfig = {
          name: { en: 'Extended Agent' },
          description: { en: 'Extended description' },
        };
        logger = winston.createLogger();
      }

      // Register base agent first
      const baseConfig: AgentConfig = {
        name: { en: 'Base Agent' },
        description: { en: 'Base description' },
        enabled: true,
      };
      await registerAgent(BaseAgent, baseConfig);

      // Register extended agent that extends base
      const extendedConfig: AgentConfig = {
        extends: AgentIds.REACT,
        name: { en: 'Extended Agent' },
        description: { en: 'Extended description' },
      };

      const token = await registerAgent(ExtendedAgent, extendedConfig);

      expect(token).toBe(AgentIds.CHAT);

      const instance = container.resolve<Agent>(AgentIds.CHAT);
      expect(instance.config.enabled).toBe(true); // Inherited from base
      expect(instance.config.name.en).toBe('Extended Agent'); // Overridden
    });

    it('should validate config when @config decorator is used on call', async () => {
      @agent(AgentIds.CHAT)
      class TestAgent extends Agent {
        id = AgentIds.CHAT;
        config: AgentConfig = {
          name: { en: 'Test Agent' },
          description: { en: 'Test description' },
        };
        logger = winston.createLogger();

        async call(_messages: any[], @config() _config: any): Promise<any> {
          return 'success';
        }
      }

      const agentConfig: AgentConfig = {
        name: { en: 'Test Agent' },
        description: { en: 'Test description' },
        config: {
          temperature: {
            type: 'number',
            required: true,
            min: 0,
            max: 1,
          },
        },
      };

      await registerAgent(TestAgent, agentConfig);
      const instance = container.resolve<Agent>(AgentIds.CHAT);

      // Validation failed
      await expect(instance.call([], { temperature: 2 })).rejects.toThrow();
      await expect(instance.call([], {})).rejects.toThrow(); // required

      // Validation passed
      await expect(instance.call([], { temperature: 0.5 })).resolves.toBe(
        'success',
      );
    });

    it('should validate config when @config decorator is used on streamCall', async () => {
      @agent(AgentIds.CHAT)
      class TestAgent extends Agent {
        id = AgentIds.CHAT;
        config: AgentConfig = {
          name: { en: 'Test Agent' },
          description: { en: 'Test description' },
        };
        logger = winston.createLogger();

        async streamCall(
          _messages: any[],
          _writer: any,
          @config() _config: any,
        ): Promise<any> {
          return 'success';
        }
      }

      const agentConfig: AgentConfig = {
        name: { en: 'Test Agent' },
        description: { en: 'Test description' },
        config: {
          mode: {
            type: 'text',
            required: true,
          },
        },
      };

      await registerAgent(TestAgent, agentConfig);
      const instance = container.resolve<TestAgent>(AgentIds.CHAT);

      // Validation failed
      await expect(instance.streamCall([], mockWriter, {})).rejects.toThrow();
      await expect(
        instance.streamCall([], mockWriter, { mode: 123 }),
      ).rejects.toThrow(); // wrong type

      // Validation passed
      await expect(
        instance.streamCall([], mockWriter, { mode: 'fast' }),
      ).resolves.toBe('success');
    });
  });

  describe('registerTool', () => {
    it('should register tool with basic config', async () => {
      @tool(ToolIds.DATE_TIME)
      class TestTool extends Tool {
        id = ToolIds.DATE_TIME;
        config: ToolConfig = {
          name: { en: 'Test Tool' },
          description: { en: 'Test description' },
        };
        logger = winston.createLogger();
      }

      const config: ToolConfig = {
        name: { en: 'Test Tool' },
        description: { en: 'Test description' },
        enabled: true,
      };

      const token = await registerTool(TestTool, config);

      expect(token).toBe(ToolIds.DATE_TIME);

      // Should be able to resolve the tool
      const instance = container.resolve<Tool>(ToolIds.DATE_TIME);
      expect(instance).toBeInstanceOf(TestTool);
      expect(instance.config).toEqual(config);
      expect(instance.id).toBe(ToolIds.DATE_TIME);
    });

    it('should handle config extension for tools', async () => {
      @tool(ToolIds.LLM_CALL)
      class BaseTool extends Tool {
        id = ToolIds.LLM_CALL;
        config: ToolConfig = {
          name: { en: 'Base Tool' },
          description: { en: 'Base description' },
          enabled: true,
        };
        logger = winston.createLogger();
      }

      @tool(ToolIds.DATE_TIME)
      class ExtendedTool extends Tool {
        id = ToolIds.DATE_TIME;
        config: ToolConfig = {
          name: { en: 'Extended Tool' },
          description: { en: 'Extended description' },
        };
        logger = winston.createLogger();
      }

      // Register base tool first
      const baseConfig: ToolConfig = {
        name: { en: 'Base Tool' },
        description: { en: 'Base description' },
        enabled: true,
      };
      await registerTool(BaseTool, baseConfig);

      // Register extended tool that extends base
      const extendedConfig: ToolConfig = {
        extends: ToolIds.LLM_CALL,
        name: { en: 'Extended Tool' },
        description: { en: 'Extended description' },
      };

      const token = await registerTool(ExtendedTool, extendedConfig);

      expect(token).toBe(ToolIds.DATE_TIME);

      const instance = container.resolve<Tool>(ToolIds.DATE_TIME);
      expect(instance.config.enabled).toBe(true); // Inherited from base
      expect(instance.config.name.en).toBe('Extended Tool'); // Overridden
    });

    it('should validate input when @input decorator is used on call', async () => {
      @tool(ToolIds.WEB_FETCH)
      class TestTool extends Tool {
        id = ToolIds.WEB_FETCH;
        config: ToolConfig = {
          name: { en: 'Test Tool' },
          description: { en: 'Test description' },
        };
        logger = winston.createLogger();

        async call(@input() _input: any): Promise<any> {
          return 'success';
        }
      }

      const config: ToolConfig = {
        name: { en: 'Test Tool' },
        description: { en: 'Test description' },
        input: {
          url: {
            type: 'text',
            required: true,
          },
        },
      };

      await registerTool(TestTool, config);

      const instance = container.resolve<Tool>(ToolIds.WEB_FETCH);

      // Should throw validation error (missing url)
      await expect(instance.call({})).rejects.toThrow();

      // Should succeed with valid input
      await expect(instance.call({ url: 'http://example.com' })).resolves.toBe(
        'success',
      );
    });

    it('should validate input when @input decorator is used on streamCall', async () => {
      @tool(ToolIds.WEB_FETCH)
      class TestTool extends Tool {
        id = ToolIds.WEB_FETCH;
        config: ToolConfig = {
          name: { en: 'Test Tool' },
          description: { en: 'Test description' },
        };
        logger = winston.createLogger();

        async streamCall(@input() _input: any, _writer: any): Promise<any> {
          return 'success';
        }
      }

      const toolConfig: ToolConfig = {
        name: { en: 'Test Tool' },
        description: { en: 'Test description' },
        input: {
          query: {
            type: 'text',
            required: true,
          },
        },
      };

      await registerTool(TestTool, toolConfig);
      const instance = container.resolve<TestTool>(ToolIds.WEB_FETCH);

      // Validation failed
      await expect(instance.streamCall({}, mockWriter)).rejects.toThrow();

      // Validation passed
      await expect(
        instance.streamCall({ query: 'hello' }, mockWriter),
      ).resolves.toBe('success');
    });
  });
});
