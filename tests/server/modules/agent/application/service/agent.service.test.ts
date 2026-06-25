import { describe, it, expect } from 'vitest';
import { AgentService } from '@/server/modules/agent/application/service/agent.service';
import { ConfigValidationError } from '@/server/modules/agent/domain/errors';

// createRunConfig / getDescriptor / getUploadLimits 不依赖 ToolService/SkillService
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
  it('getDescriptor 返回全局配置（含 tools/configSchema）', () => {
    const d = makeService().getDescriptor();
    expect(d.name).toBe('ReAct Agent');
    expect(d.tools).toEqual(
      expect.arrayContaining(['response_user', 'cached_read']),
    );
    expect(d.configSchema).toBeDefined();
  });

  it('getUploadLimits 返回全局限额', () => {
    const u = makeService().getUploadLimits();
    expect(u.maxSize).toBe(10485760);
    expect(u.maxCount).toBe(5);
  });

  describe('createRunConfig', () => {
    it('校验 userConfig 后产出 RuntimeConfigVO 快照', () => {
      const svc = makeService();
      const cfg = svc.createRunConfig(
        { model: { modelId: 'gpt-4' } },
        'prompt',
        8192,
      );

      expect(cfg.systemPrompt).toBe('prompt');
      expect(cfg.contextSize).toBe(8192);
      expect(cfg.tools).toEqual(svc.getDescriptor().tools);
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
