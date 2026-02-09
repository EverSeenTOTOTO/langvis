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
import { AgentConfig, AgentEvent, ToolConfig, ToolEvent } from '@/shared/types';
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

async function consumeAgentGenerator(
  generator: AsyncGenerator<AgentEvent, void, void>,
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of generator) {
    events.push(event);
  }
  return events;
}

async function consumeToolGenerator<T>(
  generator: AsyncGenerator<ToolEvent<T>, T, void>,
): Promise<T> {
  let result: T | undefined;
  for await (const event of generator) {
    if (event.type === 'result') {
      result = event.result;
    }
  }
  return result!;
}

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

        async *call(): AsyncGenerator<AgentEvent, void, void> {
          yield { type: 'end', agentId: this.id };
        }
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

        async *call(): AsyncGenerator<ToolEvent<unknown>, unknown, void> {
          yield { type: 'result', result: null };
          return null;
        }
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

        async *call(): AsyncGenerator<AgentEvent, void, void> {
          yield { type: 'end', agentId: this.id };
        }
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

        async *call(): AsyncGenerator<ToolEvent<unknown>, unknown, void> {
          yield { type: 'result', result: null };
          return null;
        }
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

        async *call(): AsyncGenerator<AgentEvent, void, void> {
          yield { type: 'end', agentId: this.id };
        }
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

        async *call(): AsyncGenerator<AgentEvent, void, void> {
          yield { type: 'end', agentId: this.id };
        }
      }

      @agent(AgentIds.CHAT)
      class ExtendedAgent extends Agent {
        id = AgentIds.CHAT;
        config: AgentConfig = {
          name: 'Extended Agent',
          description: 'Extended description',
        };
        logger = winston.createLogger();

        async *call(): AsyncGenerator<AgentEvent, void, void> {
          yield { type: 'end', agentId: this.id };
        }
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

        async *call(
          _memory: Memory,
          @config() _config: any,
        ): AsyncGenerator<AgentEvent, void, void> {
          yield { type: 'delta', content: 'success' };
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
        consumeAgentGenerator(instance.call(mockMemory, { temperature: 2 })),
      ).rejects.toThrow();
      await expect(
        consumeAgentGenerator(instance.call(mockMemory, {})),
      ).rejects.toThrow();
      const events = await consumeAgentGenerator(
        instance.call(mockMemory, { temperature: 0.5 }),
      );
      expect(events).toContainEqual({ type: 'delta', content: 'success' });
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

        async *call(): AsyncGenerator<ToolEvent<unknown>, unknown, void> {
          yield { type: 'result', result: null };
          return null;
        }
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

        async *call(): AsyncGenerator<ToolEvent<unknown>, unknown, void> {
          yield { type: 'result', result: null };
          return null;
        }
      }

      @tool(ToolIds.DATE_TIME)
      class ExtendedTool extends Tool {
        id = ToolIds.DATE_TIME;
        config: ToolConfig = {
          name: 'Extended Tool',
          description: 'Extended description',
        };
        logger = winston.createLogger();

        async *call(): AsyncGenerator<ToolEvent<unknown>, unknown, void> {
          yield { type: 'result', result: null };
          return null;
        }
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
      class TestTool extends Tool<{ url: string }, string> {
        id = ToolIds.WEB_FETCH;
        config: ToolConfig = {
          name: 'Test Tool',
          description: 'Test description',
        };
        logger = winston.createLogger();

        async *call(
          @input() _input: { url: string },
        ): AsyncGenerator<ToolEvent<string>, string, void> {
          yield { type: 'result', result: 'success' };
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

      const instance = container.resolve<TestTool>(ToolIds.WEB_FETCH);

      await expect(
        consumeToolGenerator(instance.call({} as any)),
      ).rejects.toThrow();
      const result = await consumeToolGenerator(
        instance.call({ url: 'http://example.com' }),
      );
      expect(result).toBe('success');
    });
  });
});
