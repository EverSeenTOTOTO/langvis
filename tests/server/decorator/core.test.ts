import { Agent } from '@/server/core/agent';
import { Memory } from '@/server/core/memory';
import { Tool } from '@/server/core/tool';
import {
  agent,
  registerAgent,
  registerTool,
  tool,
} from '@/server/decorator/core';
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
          name: 'Test Agent',
          description: 'Test description',
        };
        logger = winston.createLogger();
      }

      expect(() => container.resolve(TestAgent)).not.toThrow();
    });
  });

  describe('tool decorator', () => {
    it('should add metadata and make class injectable', () => {
      @tool(ToolIds.DATE_TIME)
      class TestTool extends Tool {
        id = ToolIds.DATE_TIME;
        config: ToolConfig = {
          name: 'Test Tool',
          description: 'Test description',
        };
        logger = winston.createLogger();
      }

      expect(() => container.resolve(TestTool)).not.toThrow();
    });
  });

  describe('registerAgent', () => {
    it('should register agent with basic config', async () => {
      @agent(AgentIds.CHAT)
      class TestAgent extends Agent {
        id = AgentIds.CHAT;
        config: AgentConfig = {
          name: 'Test Agent',
          description: 'Test description',
        };
        logger = winston.createLogger();
      }

      const configData: AgentConfig = {
        name: 'Test Agent',
        description: 'Test description',
        enabled: true,
      };

      const token = await registerAgent(TestAgent, configData);

      expect(token).toBe(AgentIds.CHAT);

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
          name: 'Test Tool',
          description: 'Test description',
        };
        logger = winston.createLogger();
      }

      @agent(AgentIds.CHAT)
      class TestAgent extends Agent {
        id = AgentIds.CHAT;
        config: AgentConfig = {
          name: 'Test Agent',
          description: 'Test description',
        };
        logger = winston.createLogger();
        tools: Tool[] = [];
      }

      const toolConfig: ToolConfig = {
        name: 'Test Tool',
        description: 'Test description',
      };
      await registerTool(TestTool, toolConfig);

      const agentConfig: AgentConfig = {
        name: 'Test Agent',
        description: 'Test description',
        tools: [ToolIds.DATE_TIME],
      };

      const token = await registerAgent(TestAgent, agentConfig);

      expect(token).toBe(AgentIds.CHAT);

      const instance = container.resolve<Agent>(AgentIds.CHAT) as TestAgent;
      expect(instance.tools).toHaveLength(1);
      expect(instance.tools[0]).toBeInstanceOf(TestTool);
    });

    it('should handle config extension', async () => {
      @agent(AgentIds.REACT)
      class BaseAgent extends Agent {
        id = AgentIds.REACT;
        config: AgentConfig = {
          name: 'Base Agent',
          description: 'Base description',
          enabled: true,
        };
        logger = winston.createLogger();
      }

      @agent(AgentIds.CHAT)
      class ExtendedAgent extends Agent {
        id = AgentIds.CHAT;
        config: AgentConfig = {
          name: 'Extended Agent',
          description: 'Extended description',
        };
        logger = winston.createLogger();
      }

      const baseConfig: AgentConfig = {
        name: 'Base Agent',
        description: 'Base description',
        enabled: true,
      };
      await registerAgent(BaseAgent, baseConfig);

      const extendedConfig: AgentConfig = {
        extends: AgentIds.REACT,
        name: 'Extended Agent',
        description: 'Extended description',
      };

      const token = await registerAgent(ExtendedAgent, extendedConfig);

      expect(token).toBe(AgentIds.CHAT);

      const instance = container.resolve<Agent>(AgentIds.CHAT);
      expect(instance.config.enabled).toBe(true);
      expect(instance.config.name).toBe('Extended Agent');
    });

    it('should validate config when @config decorator is used on call', async () => {
      @agent(AgentIds.CHAT)
      class TestAgent extends Agent {
        id = AgentIds.CHAT;
        config: AgentConfig = {
          name: 'Test Agent',
          description: 'Test description',
        };
        logger = winston.createLogger();

        async call(_memory: Memory, @config() _config: any): Promise<any> {
          return 'success';
        }
      }

      const agentConfig: AgentConfig<{ temperature: number }> = {
        name: 'Test Agent',
        description: 'Test description',
        configSchema: {
          type: 'object',
          properties: {
            temperature: { type: 'number', minimum: 0, maximum: 1 },
          },
          required: ['temperature'],
        },
      };

      await registerAgent(TestAgent, agentConfig);
      const instance = container.resolve<Agent>(AgentIds.CHAT);
      const mockMemory = {} as Memory;

      await expect(
        instance.call(mockMemory, { temperature: 2 }),
      ).rejects.toThrow();
      await expect(instance.call(mockMemory, {})).rejects.toThrow();
      await expect(
        instance.call(mockMemory, { temperature: 0.5 }),
      ).resolves.toBe('success');
    });

    it('should validate config when @config decorator is used on streamCall', async () => {
      @agent(AgentIds.CHAT)
      class TestAgent extends Agent {
        id = AgentIds.CHAT;
        config: AgentConfig = {
          name: 'Test Agent',
          description: 'Test description',
        };
        logger = winston.createLogger();

        async streamCall(
          _memory: Memory,
          _writer: any,
          @config() _config: any,
        ): Promise<any> {
          return 'success';
        }
      }

      const agentConfig: AgentConfig<{ mode: string }> = {
        name: 'Test Agent',
        description: 'Test description',
        configSchema: {
          type: 'object',
          properties: {
            mode: { type: 'string' },
          },
          required: ['mode'],
        },
      };

      await registerAgent(TestAgent, agentConfig);
      const instance = container.resolve<TestAgent>(AgentIds.CHAT);
      const mockMemory = {} as Memory;

      await expect(
        instance.streamCall(mockMemory, mockWriter, {}),
      ).rejects.toThrow();
      await expect(
        instance.streamCall(mockMemory, mockWriter, { mode: 123 }),
      ).rejects.toThrow();
      await expect(
        instance.streamCall(mockMemory, mockWriter, { mode: 'fast' }),
      ).resolves.toBe('success');
    });
  });

  describe('registerTool', () => {
    it('should register tool with basic config', async () => {
      @tool(ToolIds.DATE_TIME)
      class TestTool extends Tool {
        id = ToolIds.DATE_TIME;
        config: ToolConfig = {
          name: 'Test Tool',
          description: 'Test description',
        };
        logger = winston.createLogger();
      }

      const toolConfig: ToolConfig = {
        name: 'Test Tool',
        description: 'Test description',
        enabled: true,
      };

      const token = await registerTool(TestTool, toolConfig);

      expect(token).toBe(ToolIds.DATE_TIME);

      const instance = container.resolve<Tool>(ToolIds.DATE_TIME);
      expect(instance).toBeInstanceOf(TestTool);
      expect(instance.config).toEqual(toolConfig);
      expect(instance.id).toBe(ToolIds.DATE_TIME);
    });

    it('should handle config extension for tools', async () => {
      @tool(ToolIds.LLM_CALL)
      class BaseTool extends Tool {
        id = ToolIds.LLM_CALL;
        config: ToolConfig = {
          name: 'Base Tool',
          description: 'Base description',
          enabled: true,
        };
        logger = winston.createLogger();
      }

      @tool(ToolIds.DATE_TIME)
      class ExtendedTool extends Tool {
        id = ToolIds.DATE_TIME;
        config: ToolConfig = {
          name: 'Extended Tool',
          description: 'Extended description',
        };
        logger = winston.createLogger();
      }

      const baseConfig: ToolConfig = {
        name: 'Base Tool',
        description: 'Base description',
        enabled: true,
      };
      await registerTool(BaseTool, baseConfig);

      const extendedConfig: ToolConfig = {
        extends: ToolIds.LLM_CALL,
        name: 'Extended Tool',
        description: 'Extended description',
      };

      const token = await registerTool(ExtendedTool, extendedConfig);

      expect(token).toBe(ToolIds.DATE_TIME);

      const instance = container.resolve<Tool>(ToolIds.DATE_TIME);
      expect(instance.config.enabled).toBe(true);
      expect(instance.config.name).toBe('Extended Tool');
    });

    it('should validate input when @input decorator is used on call', async () => {
      @tool(ToolIds.WEB_FETCH)
      class TestTool extends Tool {
        id = ToolIds.WEB_FETCH;
        config: ToolConfig = {
          name: 'Test Tool',
          description: 'Test description',
        };
        logger = winston.createLogger();

        async call(@input() _input: any): Promise<any> {
          return 'success';
        }
      }

      const toolConfig: ToolConfig<{ url: string }> = {
        name: 'Test Tool',
        description: 'Test description',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string' },
          },
          required: ['url'],
        },
      };

      await registerTool(TestTool, toolConfig);

      const instance = container.resolve<Tool>(ToolIds.WEB_FETCH);

      await expect(instance.call({})).rejects.toThrow();
      await expect(instance.call({ url: 'http://example.com' })).resolves.toBe(
        'success',
      );
    });

    it('should validate input when @input decorator is used on streamCall', async () => {
      @tool(ToolIds.WEB_FETCH)
      class TestTool extends Tool {
        id = ToolIds.WEB_FETCH;
        config: ToolConfig = {
          name: 'Test Tool',
          description: 'Test description',
        };
        logger = winston.createLogger();

        async streamCall(@input() _input: any, _writer: any): Promise<any> {
          return 'success';
        }
      }

      const toolConfig: ToolConfig<{ query: string }> = {
        name: 'Test Tool',
        description: 'Test description',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
          },
          required: ['query'],
        },
      };

      await registerTool(TestTool, toolConfig);
      const instance = container.resolve<TestTool>(ToolIds.WEB_FETCH);

      await expect(instance.streamCall({}, mockWriter)).rejects.toThrow();
      await expect(
        instance.streamCall({ query: 'hello' }, mockWriter),
      ).resolves.toBe('success');
    });
  });
});
