import * as configModule from '@/server/decorator/core';
import { ExecutionContext } from '@/server/core/context';
import { ToolService } from '@/server/service/ToolService';
import { ToolEvent } from '@/shared/types';
import { globby } from 'globby';
import { container } from 'tsyringe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('globby');
vi.mock('@/server/decorator/core', async importOriginal => {
  const actual = await importOriginal<typeof configModule>();
  return {
    ...actual,
    registerTool: vi.fn(),
  };
});

describe('ToolService', () => {
  let toolService: ToolService;

  beforeEach(() => {
    vi.clearAllMocks();
    container.clearInstances();
  });

  afterEach(() => {
    container.clearInstances();
  });

  describe('initialization', () => {
    it('should discover and register tools', async () => {
      const mockToolPath = '/path/to/tool/index.ts';
      const mockConfig = { name: { en: 'Test Tool', zh: '测试工具' } };
      const mockToolClass = class TestTool {};

      vi.mocked(globby).mockResolvedValue([mockToolPath]);
      vi.doMock(mockToolPath, () => ({ default: mockToolClass }));
      vi.doMock('/path/to/tool/config.ts', () => ({ config: mockConfig }));
      vi.mocked(configModule.registerTool).mockResolvedValue('test-tool');

      toolService = container.resolve(ToolService);
      const result = await toolService.getAllToolInfo();

      expect(globby).toHaveBeenCalledWith(
        expect.stringContaining('server/core/tool/*/index'),
        expect.any(Object),
      );
      expect(result).toBeDefined();
    });

    it('should handle empty tool discovery', async () => {
      vi.mocked(globby).mockResolvedValue([]);
      vi.mocked(configModule.registerTool).mockResolvedValue('test-tool');

      toolService = container.resolve(ToolService);
      const result = await toolService.getAllToolInfo();

      expect(result).toEqual([]);
    });

    it('should handle initialization errors gracefully', async () => {
      vi.mocked(globby).mockRejectedValue(new Error('Discovery failed'));

      toolService = container.resolve(ToolService);
      const result = await toolService.getAllToolInfo();

      expect(result).toEqual([]);
    });

    it('should initialize only once', async () => {
      vi.mocked(globby).mockResolvedValue([]);

      toolService = container.resolve(ToolService);
      await toolService.getAllToolInfo();
      await toolService.getAllToolInfo();

      expect(globby).toHaveBeenCalledTimes(1);
    });
  });

  describe('callTool', () => {
    beforeEach(() => {
      vi.mocked(globby).mockResolvedValue([]);
    });

    it('should call tool with input', async () => {
      const mockTool = {
        id: 'test-tool',
        config: { name: { en: 'Test', zh: '测试' } },
        call: vi.fn().mockImplementation(async function* (): AsyncGenerator<
          ToolEvent,
          string,
          void
        > {
          yield {
            type: 'result',
            toolName: 'test-tool',
            output: '"result"',
          };
          return 'result';
        }),
      };

      toolService = container.resolve(ToolService);
      (toolService as any).tools = ['test-tool'];
      container.register('test-tool', { useValue: mockTool });

      const result = await toolService.callTool('test-tool', { input: 'data' });

      expect(mockTool.call).toHaveBeenCalledWith(
        { input: 'data' },
        expect.any(ExecutionContext),
      );
      expect(result).toBe('result');
    });

    it('should throw error for non-existent tool', async () => {
      toolService = container.resolve(ToolService);

      await expect(toolService.callTool('non-existent', {})).rejects.toThrow(
        'Tool not found: non-existent',
      );
    });
  });
});
