import { describe, it, expect } from 'vitest';
import { AgentService } from '@/server/modules/agent/application/service/agent.service';
import type { ToolService } from '@/server/modules/agent/application/service/tool.service';
import type { SkillService } from '@/server/modules/agent/application/service/skill.service';
import type { Tool } from '@/server/modules/agent/domain/model/tool.base';
import { ToolSet } from '@/server/modules/agent/domain/model/tool-set.vo';

const tool = (id: string, description: string) =>
  ({ id, config: { description } }) as unknown as Tool;

const toolService = {
  resolve: (id: string) =>
    ({
      bash: tool('bash', 'Executes a bash command.'),
      web_fetch: tool('web_fetch', 'Fetches a URL and returns content.'),
    })[id],
} as unknown as ToolService;

const toolSet = ToolSet.of(
  [
    { id: 'bash', mode: 'inline', concurrency: undefined },
    { id: 'web_fetch', mode: 'listed', concurrency: undefined },
  ],
  ['translate'],
);

describe('AgentService.buildSystemPrompt roster', () => {
  it('listed 工具与 toolSet 内 skill 以单行 roster 常驻；inline 工具走全量文档不进 roster', async () => {
    const skillService = {
      getAllSkillInfo: async () => [
        { id: 'translate', name: '翻译', description: '中英互译。' },
        { id: 'other', name: 'x', description: 'y' },
      ],
    } as unknown as SkillService;
    const service = new AgentService(toolService, skillService);

    const prompt = await service.buildSystemPrompt(toolSet);

    expect(prompt).toContain(
      '- `web_fetch` — Fetches a URL and returns content.',
    );
    expect(prompt).toContain('- `translate` — 中英互译。');
    // inline 工具是全量文档段，不出现单行形态
    expect(prompt).not.toContain('- `bash` —');
    // 不在 toolSet skillIds 内的 skill 不出现
    expect(prompt).not.toContain('`other`');
  });

  it('空技能集不追加 skill roster 段', async () => {
    const skillService = {
      getAllSkillInfo: async () => [],
    } as unknown as SkillService;
    const service = new AgentService(toolService, skillService);

    const prompt = await service.buildSystemPrompt(toolSet);

    expect(prompt).not.toContain('Available skills (load via');
  });
});
