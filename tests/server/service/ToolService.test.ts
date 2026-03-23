import * as configModule from '@/server/decorator/core';
import { ToolService } from '@/server/service/ToolService';
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
      vi.mocked(configModule.registerTool).mockImplementation(async token => {
        // @ts-expect-error tsyringe register signature mismatch
        container.register(token, { useValue: mockToolClass });
        return token;
      });

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
});
