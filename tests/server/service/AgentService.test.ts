import { describe, it, expect, beforeEach, vi } from 'vitest';
import AgentService from '@/server/service/AgentService';
import { container } from 'tsyringe';
import { ToolNames } from '@/server/utils';
import { InjectTokens } from '@/server/utils';

// Mock globby to avoid file system operations
vi.mock('globby', () => ({
  globby: vi
    .fn()
    .mockResolvedValue([
      '/src/server/core/agent/DateTime/index.ts',
      '/src/server/core/agent/LlmCall/index.ts',
      '/src/server/core/agent/ReAct/index.ts',
    ]),
}));

// Create mock agent classes that implement the Agent interface
class MockDateTimeTool {
  static Name = ToolNames.DATE_TIME_TOOL;
  static Description = 'A tool to get the current date and time.';
  call = vi.fn();
  streamCall = vi.fn();
}

class MockLlmCallTool {
  static Name = ToolNames.LLM_CALL_TOOL;
  static Description = 'A tool to perform a single call of Llm.';
  call = vi.fn();
  streamCall = vi.fn();
}

class MockReActAgent {
  static Name = ToolNames.REACT_AGENT;
  static Description = 'An agent that uses the ReAct framework.';
  call = vi.fn();
  streamCall = vi.fn();
}

// Mock dynamic imports for agent modules
vi.mock('@/server/core/agent/DateTime/index.ts', () => ({
  default: MockDateTimeTool,
}));

vi.mock('@/server/core/agent/LlmCall/index.ts', () => ({
  default: MockLlmCallTool,
}));

vi.mock('@/server/core/agent/ReAct/index.ts', () => ({
  default: MockReActAgent,
}));

// Mock OpenAI
const mockOpenAI = {
  chat: {
    completions: {
      create: vi.fn().mockResolvedValue({
        choices: [{ message: { content: 'test response' } }],
      }),
    },
  },
};

describe('AgentService', () => {
  beforeEach(() => {
    // Reset the service state before each test
    const service = new (AgentService.constructor as any)();
    Object.assign(AgentService, service);

    // Register required dependencies
    container.register(InjectTokens.OPENAI, { useValue: mockOpenAI });

    // Clear mock call history
    vi.clearAllMocks();

    // Clear container registrations
    container.clearInstances();
  });

  it('should get all agents', async () => {
    const agents = await AgentService.getAllAgents();
    expect(Array.isArray(agents)).toBe(true);
    // We expect exactly three agents
    expect(agents.length).toBe(3);

    // Check that all expected agents are present
    const agentNames = agents.map(agent => agent.name);
    expect(agentNames).toContain(ToolNames.DATE_TIME_TOOL);
    expect(agentNames).toContain(ToolNames.LLM_CALL_TOOL);
    expect(agentNames).toContain(ToolNames.REACT_AGENT);
  });

  it('should get an agent by name', async () => {
    const agent = await AgentService.getAgentByName(ToolNames.DATE_TIME_TOOL);
    expect(agent).toBeDefined();
    expect(agent?.name).toBe(ToolNames.DATE_TIME_TOOL);
    expect(agent?.description).toBeDefined();
  });

  it('should return undefined for non-existent agent', async () => {
    const agent = await AgentService.getAgentByName('NonExistentAgent');
    expect(agent).toBeUndefined();
  });

  it('should register agents in the container', async () => {
    // Initialize the agent service to register agents
    await AgentService.getAllAgents();

    // Check that each agent is registered in the container
    expect(() => container.resolve(ToolNames.DATE_TIME_TOOL)).not.toThrow();
    expect(() => container.resolve(ToolNames.LLM_CALL_TOOL)).not.toThrow();
    expect(() => container.resolve(ToolNames.REACT_AGENT)).not.toThrow();

    // Verify that we can resolve instances
    const dateTimeTool: any = container.resolve(ToolNames.DATE_TIME_TOOL);
    const llmCallTool: any = container.resolve(ToolNames.LLM_CALL_TOOL);
    const reactAgent: any = container.resolve(ToolNames.REACT_AGENT);

    expect(dateTimeTool).toBeDefined();
    expect(llmCallTool).toBeDefined();
    expect(reactAgent).toBeDefined();

    // Verify that they have the expected methods
    expect(typeof dateTimeTool.call).toBe('function');
    expect(typeof llmCallTool.call).toBe('function');
    expect(typeof reactAgent.streamCall).toBe('function');
  });
});
