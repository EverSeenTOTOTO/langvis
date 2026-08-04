import { inject, singleton } from 'tsyringe';
import type { JSONSchemaType } from 'ajv';
import { ToolIds } from '@/shared/constants';
import type { Tool } from '../../domain/model/tool.base';
import { ToolSet } from '../../domain/model/tool-set.vo';
import type { ToolMember } from '../../domain/model/tool-set.vo';
import { RunConfigVO } from '../../domain/model/run-config.vo';
import { configSchema, type ConversationConfig } from '@/server/libs/config';
import { BASE_PROMPT } from './base-prompt';
import { ToolService } from './tool.service';
import { SkillService } from './skill.service';
import { formatToolsToMarkdown } from '@/server/utils/formatTools';

@singleton()
export class AgentService {
  private readonly inlineTools = [
    ToolIds.RESPONSE_USER,
    ToolIds.ASK_USER,
    ToolIds.SKILL_CALL,
    ToolIds.LIST_TOOLS,
    ToolIds.CALL_SUBAGENTS,
    ToolIds.BASH,
  ];

  private cachedPrompt: Promise<string> | null = null;

  constructor(
    @inject(ToolService) private readonly toolService: ToolService,
    @inject(SkillService) private readonly skillService: SkillService,
  ) {}

  getConfigSchema(): JSONSchemaType<Record<string, unknown>> {
    return configSchema as JSONSchemaType<Record<string, unknown>>;
  }

  // 全局 conv agent 的 system prompt：内容固定，首次构建后 memoize（等价 buildSystemPrompt(buildToolSet())）。
  getSystemPrompt(): Promise<string> {
    if (!this.cachedPrompt) {
      this.cachedPrompt = (async () => {
        await Promise.all([
          this.toolService.initialize(),
          this.skillService.initialize(),
        ]);
        return this.buildSystemPrompt(this.buildToolSet());
      })();
    }
    return this.cachedPrompt;
  }

  /** 从 conv 侧已 parse 的 runtimeConfig 直接产出 RunConfigVO——无需二次 parse。 */
  buildResolvedRunConfig(runtimeConfig: ConversationConfig): RunConfigVO {
    return RunConfigVO.of({
      tools: this.inlineTools,
      runtimeConfig,
    });
  }

  // 构建 ToolSet：全集 = 已发现工具，inline/listed 分类沿用 inlineTools 顺序；可剔除指定 id（子 agent 派生用）。
  buildToolSet(exclude: string[] = []): ToolSet {
    const discovered = this.toolService.getCachedToolIds();
    const inlineSet = new Set(this.inlineTools as string[]);
    const excludeSet = new Set(exclude);
    const inlineIds = this.inlineTools.filter(
      id => discovered.includes(id) && !excludeSet.has(id),
    ) as string[];
    const listedIds = discovered.filter(
      id => !inlineSet.has(id) && !excludeSet.has(id),
    );
    const members: ToolMember[] = [
      ...inlineIds.map(id => ({ id, mode: 'inline' as const })),
      ...listedIds.map(id => ({ id, mode: 'listed' as const })),
    ];
    const skillIds = this.skillService
      .getCachedSkillIds()
      .filter(id => !excludeSet.has(id));
    return ToolSet.of(members, skillIds);
  }

  // 按 ToolSet 渲染 system prompt（per-run，conv 与子 agent 复用）
  buildSystemPrompt(toolSet: ToolSet, base = BASE_PROMPT): string {
    const inlineTools = toolSet
      .inlineIds()
      .map(id => this.toolService.resolve(id))
      .filter((t): t is Tool => t !== undefined);

    return base
      .insertBefore(
        'Skills',
        'Tools',
        formatToolsToMarkdown(inlineTools, { detail: true }),
      )
      .build();
  }
}
