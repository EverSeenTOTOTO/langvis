import { inject } from 'tsyringe';
import { Role } from '@/shared/entities/Message';
import { ToolIds } from '@/shared/constants';
import type { AgentRunContext } from '@/server/modules/agent/domain/port/agent-run-context.port';
import type {
  Hook,
  HookDirective,
  HookPhase,
} from '@/server/modules/agent/domain/model/hook';
import type { RunEvent } from '@/shared/types/events';
import { retrieveRelevantTools } from '@/server/utils/tool-retrieval';
import {
  formatToolsToMarkdown,
  formatSkillsToMarkdown,
} from '@/server/utils/formatTools';
import { ToolService } from '@/server/modules/agent/application/service/tool.service';
import { SkillService } from '@/server/modules/agent/application/service/skill.service';
import Logger from '@/server/utils/logger';
import { agentHook } from './registry';

const MAX_ITEMS = 8;

/**
 * pre-llm 首 tick：用 user query 检索命中工具/skill，把「建议式前缀 + 全量 schema」
 * 作为 user note 注入，启发 agent 用对工具（小模型只给 id+描述会瞎猜参数）。
 * 仅 conv（interactive）注入一次；subagent/eval 跳过（其受限 ToolSet 不在 ctx 上）。
 */
@agentHook
export class ToolHintHook implements Hook {
  readonly id = 'tool-hint';
  readonly phase: HookPhase = 'pre-llm';
  private readonly logger = Logger.child({ source: 'ToolHintHook' });
  private done = false;

  constructor(
    @inject(ToolService) private readonly toolService: ToolService,
    @inject(SkillService) private readonly skillService: SkillService,
  ) {}

  async *apply(ctx: AgentRunContext): AsyncGenerator<RunEvent, HookDirective> {
    if (!ctx.interactive || this.done) return 'next';
    this.done = true;

    const query = lastUserContent(ctx.messages);
    const { tools, skills } = await retrieveRelevantTools(
      this.toolService,
      this.skillService,
      query,
      { excludeToolIds: [ToolIds.LIST_TOOLS] },
    );
    const total = tools.length + skills.length;
    if (total === 0) return 'next';

    const capTools = tools.slice(0, MAX_ITEMS);
    const remaining = MAX_ITEMS - capTools.length;
    const capSkills = remaining > 0 ? skills.slice(0, remaining) : [];
    const shown = capTools.length + capSkills.length;

    const parts: string[] = [
      '[tool-hint] 以下工具/技能或许对处理你的请求有帮助（仅供参考，非必选；如需重新检索或查看其余请调用 list_tools）：',
      formatToolsToMarkdown(capTools, { detail: true }),
      formatSkillsToMarkdown(capSkills),
    ];
    if (total > shown) {
      parts.push(`…（共 ${total} 项，已显示前 ${shown}；其余调 list_tools）`);
    }

    ctx.messages = ctx.messages.append({
      role: Role.USER,
      content: parts.filter(Boolean).join('\n---\n'),
    });
    this.logger.debug(
      `tool-hint injected (run ${ctx.runId}): ${tools.length}t/${skills.length}s`,
    );
    return 'next';
  }
}

function lastUserContent(
  messages: AgentRunContext['messages'],
): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages.get(i);
    if (m?.role === Role.USER) return m.content;
  }
  return undefined;
}
