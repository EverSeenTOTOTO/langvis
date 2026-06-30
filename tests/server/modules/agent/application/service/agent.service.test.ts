import { describe, it, expect } from 'vitest';
import '@/server/libs/compaction';
import '@/server/modules/agent/application/service/model-config.fragment';
import { AgentService } from '@/server/modules/agent/application/service/agent.service';
import { ConfigValidationError } from '@/server/modules/agent/domain/errors';

// createRunConfig / getConfigSchema 不依赖 ToolService/SkillService
// （仅 getSystemPrompt 需要工具发现）。此处用 stub 构造，避开 DI。
const stubToolService = {
  initialize: () => Promise.resolve(),
  getCachedToolIds: () => [],
} as any;
const stubSkillService = {
  initialize: () => Promise.resolve(),
  getCachedSkillIds: () => [],
} as any;

function makeService() {
  return new AgentService(stubToolService, stubSkillService);
}

describe('AgentService', () => {
  it('getConfigSchema 返回聚合后的对话配置 schema（各域 fragment 平铺）', () => {
    const schema = makeService().getConfigSchema();
    expect(schema).toBeDefined();
    expect(Object.keys(schema.properties ?? {})).toEqual(
      expect.arrayContaining(['model', 'memory']),
    );
  });

  describe('createRunConfig', () => {
    it('校验 userConfig 后产出 RuntimeConfigVO 快照', () => {
      const cfg = makeService().createRunConfig(
        { model: { modelId: 'gpt-4' } },
        'prompt',
        8192,
      );

      expect(cfg.systemPrompt).toBe('prompt');
      expect(cfg.contextSize).toBe(8192);
      expect(cfg.tools).toEqual(
        expect.arrayContaining(['response_user', 'cached_read']),
      );
      expect(cfg.runtimeConfig).toMatchObject({ model: { modelId: 'gpt-4' } });
      expect(Object.isFrozen(cfg)).toBe(true);
    });

    it('非法 userConfig 抛 ConfigValidationError', () => {
      // temperature 超出 schema 的 maximum(1)
      expect(() =>
        makeService().createRunConfig(
          { model: { temperature: 99 } },
          'p',
          4000,
        ),
      ).toThrow(ConfigValidationError);
    });
  });
});
