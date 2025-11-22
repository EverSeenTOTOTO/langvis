import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentService } from '@/server/service/AgentService';
import { container } from 'tsyringe';
import { AGENT_META, ENTITY_TYPES } from '@/shared/constants';
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
  static Name = AGENT_META.DATE_TIME_TOOL.Name.en;
  static Description = AGENT_META.DATE_TIME_TOOL.Description.en;
  static Type = ENTITY_TYPES.TOOL;
  call = vi.fn();
  streamCall = vi.fn();
}

class MockLlmCallTool {
  static Name = AGENT_META.LLM_CALL_TOOL.Name.en;
  static Description = AGENT_META.LLM_CALL_TOOL.Description.en;
  static Type = ENTITY_TYPES.TOOL;
  call = vi.fn();
  streamCall = vi.fn();
}

class MockReActAgent {
  static Name = AGENT_META.REACT_AGENT.Name.en;
  static Description = AGENT_META.REACT_AGENT.Description.en;
  static Type = ENTITY_TYPES.AGENT;
  call = vi.fn();
  streamCall = vi.fn();
  tools: any[] = []; // Add tools property for ReActAgent
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
  let agentService: AgentService;

  beforeEach(() => {
    // Create a new instance of AgentService for each test
    agentService = new AgentService();

    // Register required dependencies
    container.register(InjectTokens.OPENAI, { useValue: mockOpenAI });

    // Clear mock call history
    vi.clearAllMocks();

    // Clear container registrations
    container.clearInstances();
  });

  it('should get all agents', async () => {
    const agents = await agentService.getAllAgents();
    expect(Array.isArray(agents)).toBe(true);
    // We expect exactly one agent (ReAct) since tools are filtered out
    expect(agents.length).toBe(1);

    // Check that the expected agent is present
    const agentNames = agents.map(agent => agent.name);
    expect(agentNames).toContain(AGENT_META.REACT_AGENT.Name.en);
  });

  it('should get an agent by name', async () => {
    const agent = await agentService.getAgentByName(
      AGENT_META.REACT_AGENT.Name.en,
    );
    expect(agent).toBeDefined();
    expect(agent?.name).toBe(AGENT_META.REACT_AGENT.Name.en);
    expect(agent?.description).toBeDefined();
  });

  it('should return undefined for non-existent agent', async () => {
    const agent = await agentService.getAgentByName('NonExistentAgent');
    expect(agent).toBeUndefined();
  });

  it('should register agents in the container', async () => {
    // Initialize the agent service to register agents
    await agentService.getAllAgents();

    // Check that the agent is registered in the container
    expect(() =>
      container.resolve(AGENT_META.REACT_AGENT.Name.en),
    ).not.toThrow();

    // Verify that we can resolve instances
    const reactAgent: any = container.resolve(AGENT_META.REACT_AGENT.Name.en);

    expect(reactAgent).toBeDefined();

    // Verify that it has the expected methods
    expect(typeof reactAgent.streamCall).toBe('function');

    // Verify that tools were injected
    expect(Array.isArray(reactAgent.tools)).toBe(true);
  });

  it('should register tools and agents correctly', async () => {
    // Initialize the agent service to register agents
    await agentService.getAllAgents();

    // Check that both tools and agent are registered
    expect(() =>
      container.resolve(AGENT_META.DATE_TIME_TOOL.Name.en),
    ).not.toThrow();
    expect(() =>
      container.resolve(AGENT_META.LLM_CALL_TOOL.Name.en),
    ).not.toThrow();
    expect(() =>
      container.resolve(AGENT_META.REACT_AGENT.Name.en),
    ).not.toThrow();

    // Verify that we can resolve instances
    const dateTimeTool: any = container.resolve(
      AGENT_META.DATE_TIME_TOOL.Name.en,
    );
    const llmCallTool: any = container.resolve(
      AGENT_META.LLM_CALL_TOOL.Name.en,
    );
    const reactAgent: any = container.resolve(AGENT_META.REACT_AGENT.Name.en);

    expect(dateTimeTool).toBeDefined();
    expect(llmCallTool).toBeDefined();
    expect(reactAgent).toBeDefined();

    // The tools should be injected through the afterResolution hook
    // Since we're using mocks, we need to verify that the hook worked
    // by checking if tools were populated correctly
    expect(Array.isArray(reactAgent.tools)).toBe(true);
    expect(reactAgent.tools.length).toBe(2);

    // Verify that they have the expected methods
    expect(typeof dateTimeTool.call).toBe('function');
    expect(typeof llmCallTool.call).toBe('function');
    expect(typeof reactAgent.streamCall).toBe('function');
  });
});
