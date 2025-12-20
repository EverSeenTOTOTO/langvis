import { describe, it, expect, beforeAll, vi } from 'vitest';
import { ToolService } from '@/server/service/ToolService';
import { container } from 'tsyringe';
import { InjectTokens } from '@/server/utils';

describe('ToolService', () => {
  let toolService: ToolService;

  beforeAll(async () => {
    const MockOpenAI = vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: 'test response' } }],
          }),
        },
      },
    }));

    const mockOpenAI = new MockOpenAI({ apiKey: 'test-key' });
    container.register(InjectTokens.OPENAI, { useValue: mockOpenAI });

    toolService = new ToolService();
    await new Promise(resolve => setTimeout(resolve, 100));
    await toolService.getAllToolInfo();
  });

  describe('callTool', () => {
    it('should call DateTime Tool successfully', async () => {
      const result = await toolService.callTool('DateTime Tool', {
        format: 'YYYY-MM-DD',
      });

      expect(typeof result).toBe('string');
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('should throw error if tool not found', async () => {
      await expect(
        toolService.callTool('NonExistent Tool', {}),
      ).rejects.toThrow('Tool not found: NonExistent Tool');
    });

    it('should propagate tool execution errors', async () => {
      await expect(
        toolService.callTool('DateTime Tool', { timezone: 'Invalid/Timezone' }),
      ).rejects.toThrow('Invalid timezone');
    });
  });

  describe('getAllToolInfo', () => {
    it('should return all registered tools', async () => {
      const tools = await toolService.getAllToolInfo();

      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);

      const toolNames = tools.map(t => t.name);
      expect(toolNames).toContain('DateTime Tool');
      expect(toolNames).toContain('LlmCall Tool');
      expect(toolNames).toContain('TextToSpeech Tool');
    });

    it('should return tools with correct structure', async () => {
      const tools = await toolService.getAllToolInfo();

      tools.forEach(tool => {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(typeof tool.name).toBe('string');
        expect(typeof tool.description).toBe('string');
      });
    });
  });

  describe('getToolsByNames', () => {
    it('should resolve multiple tools by names', async () => {
      const tools = await toolService.getToolsByNames([
        'DateTime Tool',
        'LlmCall Tool',
      ]);

      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe('DateTime Tool');
      expect(tools[1].name).toBe('LlmCall Tool');
    });

    it('should return empty array for empty names list', async () => {
      const tools = await toolService.getToolsByNames([]);
      expect(tools).toEqual([]);
    });
  });
});
