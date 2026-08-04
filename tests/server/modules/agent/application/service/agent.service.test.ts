import { describe, it, expect } from 'vitest';
import { AgentService } from '@/server/modules/agent/application/service/agent.service';

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
      expect.arrayContaining(['model', 'loop']),
    );
  });
});
