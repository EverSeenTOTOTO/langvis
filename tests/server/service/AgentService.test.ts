import { describe, it, expect, beforeAll, vi } from 'vitest';
import { container } from 'tsyringe';
import { AgentService } from '@/server/service/AgentService';
import { ToolService } from '@/server/service/ToolService';
import { InjectTokens } from '@/server/utils';

describe('AgentService: Config → Container Registration Integration Tests', () => {
  beforeAll(async () => {
    // Mock OpenAI (the class imported in the service files)
    const MockOpenAI = vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: 'test response' } }],
          }),
        },
      },
    }));

    // Register the mock OpenAI instance to container (same as controller/index.ts does)
    const mockOpenAI = new MockOpenAI({ apiKey: 'test-key' });
    container.register(InjectTokens.OPENAI, { useValue: mockOpenAI });

    // Initialize AgentService - the constructor calls this.initialize() asynchronously
    const toolService = new ToolService();
    const agentService = new AgentService(toolService);

    // Wait for the async initialization to complete by calling getAllAgentInfo()
    // This ensures agents are discovered and registered before tests run
    await agentService.getAllAgentInfo();
  });

  describe('Core Contract: config.json name.en → container token', () => {
    it('should register agents using display name from config.json, not class name', () => {
      /**
       * CRITICAL: Container must be registered with config.name.en
       *
       * Why: Frontend sends config.name.en, database stores config.name.en,
       *      so container MUST use config.name.en as the token.
       */

      // Should resolve with display names (from config.name.en)
      expect(() => container.resolve('Chat Agent')).not.toThrow();
      expect(() => container.resolve('ReAct Agent')).not.toThrow();

      // Should NOT resolve with class names
      expect(() => container.resolve('ChatAgent')).toThrow(
        /unregistered dependency/,
      );
      expect(() => container.resolve('ReActAgent')).toThrow(
        /unregistered dependency/,
      );
    });

    it('should register tools using display name from config.json, not class name', () => {
      // Should resolve with display names
      expect(() => container.resolve('LlmCall Tool')).not.toThrow();
      expect(() => container.resolve('DateTime Tool')).not.toThrow();

      // Should NOT resolve with class names
      expect(() => container.resolve('LlmCallTool')).toThrow(
        /unregistered dependency/,
      );
      expect(() => container.resolve('DateTimeTool')).toThrow(
        /unregistered dependency/,
      );
    });
  });

  describe('Metadata Injection: config.json → instance properties', () => {
    it('should inject name and description from config into Chat Agent instance', () => {
      const chatAgent: any = container.resolve('Chat Agent');

      // Verify injected metadata matches config.json
      expect(chatAgent.name).toBe('Chat Agent');
      expect(chatAgent.description).toContain('conversational');
      expect(chatAgent.description.length).toBeGreaterThan(0);
    });

    it('should inject name and description from config into ReAct Agent instance', () => {
      const reactAgent: any = container.resolve('ReAct Agent');

      // Verify injected metadata matches config.json
      expect(reactAgent.name).toBe('ReAct Agent');
      expect(reactAgent.description).toContain('ReAct');
      expect(reactAgent.description.length).toBeGreaterThan(0);
    });

    it('should inject name and description from config into LlmCall Tool instance', () => {
      const llmCallTool: any = container.resolve('LlmCall Tool');

      // Verify injected metadata
      expect(llmCallTool.name).toBe('LlmCall Tool');
      expect(llmCallTool.description).toBeDefined();
      expect(llmCallTool.description.length).toBeGreaterThan(0);
    });

    it('should inject name and description from config into DateTime Tool instance', () => {
      const dateTimeTool: any = container.resolve('DateTime Tool');

      // Verify injected metadata
      expect(dateTimeTool.name).toBe('DateTime Tool');
      expect(dateTimeTool.description).toContain('date');
      expect(dateTimeTool.description.length).toBeGreaterThan(0);
    });
  });

  describe('Tool Dependencies: Agent config.tools → injected tool instances', () => {
    it('should inject tools into ReAct Agent using display names from config.tools array', () => {
      const reactAgent: any = container.resolve('ReAct Agent');

      // Verify tools array is injected
      expect(reactAgent.tools).toBeDefined();
      expect(Array.isArray(reactAgent.tools)).toBe(true);
      expect(reactAgent.tools.length).toBe(2); // LlmCall Tool + DateTime Tool

      // Verify injected tools have correct names (from their config files)
      const toolNames = reactAgent.tools.map((tool: any) => tool.name);
      expect(toolNames).toContain('LlmCall Tool'); // NOT 'LlmCallTool'
      expect(toolNames).toContain('DateTime Tool'); // NOT 'DateTimeTool'

      // Verify each tool is properly injected with metadata
      reactAgent.tools.forEach((tool: any) => {
        expect(tool.name).toBeDefined();
        expect(tool.description).toBeDefined();
        expect(tool.name).toMatch(/\s/); // Display name has space
      });
    });

    it('verifies tools are resolved by display name during agent initialization', () => {
      /**
       * This tests the critical flow:
       * 1. Agent config.json has: "tools": ["LlmCall Tool", "DateTime Tool"]
       * 2. AgentService reads this array
       * 3. For each tool name, calls: container.resolve(toolName)
       * 4. If toolName was class name "LlmCallTool", resolve would fail
       * 5. But since it's "LlmCall Tool", resolve succeeds
       */

      const reactAgent: any = container.resolve('ReAct Agent');

      // If this resolves without error, it means:
      // - Tools were registered with display names
      // - Agent config references tools by display names
      // - Container successfully resolved and injected them
      expect(reactAgent.tools.length).toBeGreaterThan(0);

      // Verify we can resolve the same tools directly
      const llmCallTool: any = container.resolve('LlmCall Tool');
      const dateTimeTool: any = container.resolve('DateTime Tool');

      // The injected tools should be the same instances (singleton)
      expect(reactAgent.tools).toContainEqual(llmCallTool);
      expect(reactAgent.tools).toContainEqual(dateTimeTool);
    });
  });

  describe('API Contract: AgentService.getAllAgentInfo() returns display names', () => {
    it('should return agent info with display names as keys', async () => {
      const toolService = new ToolService();
      const agentService = new AgentService(toolService);
      const agentInfos = await agentService.getAllAgentInfo();

      expect(agentInfos.length).toBeGreaterThan(0);

      // Find our agents
      const chatInfo = agentInfos.find(info => info.name === 'Chat Agent');
      const reactInfo = agentInfos.find(info => info.name === 'ReAct Agent');

      expect(chatInfo).toBeDefined();
      expect(reactInfo).toBeDefined();

      // Verify the names are display names, not class names
      expect(chatInfo!.name).toMatch(/\s/); // Contains space
      expect(reactInfo!.name).toMatch(/\s/); // Contains space
    });

    it('ensures agent info names can be used to resolve from container', async () => {
      /**
       * This is THE critical test that proves the contract:
       * AgentService.getAllAgentInfo() returns names that work as container tokens
       */
      const toolService = new ToolService();
      const agentService = new AgentService(toolService);
      const agentInfos = await agentService.getAllAgentInfo();

      for (const agentInfo of agentInfos) {
        // The name from API should work as container token
        const agent: any = container.resolve(agentInfo.name);

        expect(agent).toBeDefined();
        expect(agent.name).toBe(agentInfo.name);
        expect(agent.description).toBe(agentInfo.description);
      }
    });
  });

  describe('Complete Flow: Frontend → Database → Container', () => {
    it('simulates the complete user flow with display names', async () => {
      /**
       * This test simulates the real-world flow:
       *
       * 1. Frontend calls GET /api/agent
       * 2. AgentService returns agent infos with display names
       * 3. User selects "Chat Agent" in UI
       * 4. Frontend POST /api/conversation with config: {agent: "Chat Agent"}
       * 5. Database stores: {config: {agent: "Chat Agent"}}
       * 6. User sends message
       * 7. ChatController reads config.agent from database
       * 8. ChatController calls container.resolve(config.agent)
       * 9. Agent is successfully resolved and executes
       */

      // Step 1-2: Get agent info (simulating API call)
      const toolService = new ToolService();
      const agentService = new AgentService(toolService);
      const agentInfos = await agentService.getAllAgentInfo();

      // Step 3: User selects agent (simulating frontend)
      const selectedAgent = agentInfos.find(a => a.name === 'Chat Agent');
      expect(selectedAgent).toBeDefined();

      // Step 4-5: Store in database (simulated)
      const conversationConfig = {
        agent: selectedAgent!.name, // "Chat Agent"
      };

      // Step 6-8: Resolve agent (simulating ChatController)
      const agent: any = container.resolve(conversationConfig.agent);

      // Step 9: Verify agent is usable
      expect(agent).toBeDefined();
      expect(agent.name).toBe('Chat Agent');
      expect(typeof agent.streamCall).toBe('function');
      expect(typeof agent.getSystemPrompt).toBe('function');

      /**
       * KEY INSIGHT: If AgentService had registered with class name "ChatAgent",
       * this test would fail at step 8 with:
       * "Attempted to resolve unregistered dependency token: Chat Agent"
       */
    });
  });

  describe('Regression Prevention', () => {
    it('prevents accidental use of class names anywhere in the chain', () => {
      // These should all fail, proving we're NOT using class names
      expect(() => container.resolve('ChatAgent')).toThrow();
      expect(() => container.resolve('ReActAgent')).toThrow();
      expect(() => container.resolve('LlmCallTool')).toThrow();
      expect(() => container.resolve('DateTimeTool')).toThrow();

      // These should all work, proving we ARE using display names
      expect(() => container.resolve('Chat Agent')).not.toThrow();
      expect(() => container.resolve('ReAct Agent')).not.toThrow();
      expect(() => container.resolve('LlmCall Tool')).not.toThrow();
      expect(() => container.resolve('DateTime Tool')).not.toThrow();
    });

    it('verifies all agent info names contain spaces (display name pattern)', async () => {
      const toolService = new ToolService();
      const agentService = new AgentService(toolService);
      const agentInfos = await agentService.getAllAgentInfo();

      for (const agentInfo of agentInfos) {
        // Display names should have spaces
        expect(agentInfo.name).toMatch(/\s/);

        // Should not match PascalCase pattern (class names)
        expect(agentInfo.name).not.toMatch(/^[A-Z][a-z]+[A-Z][a-z]+$/);
      }
    });
  });
});
