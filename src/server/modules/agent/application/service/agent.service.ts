import { ToolIds } from '@/shared/constants';
import type { Tool } from '../../domain/model/tool.base';
import { ToolSet } from '../../domain/model/tool-set.vo';
import type { ToolMember } from '../../domain/model/tool-set.vo';
import { RunConfigVO } from '../../domain/model/run-config.vo';
import type { ConversationConfig } from '@/server/modules/conversation/domain/config';
import { BASE_PROMPT } from './base-prompt';
import { ToolService } from './tool.service';
import { SkillService } from './skill.service';
import { Inject, type OnApplicationBootstrap } from '@nestjs/common';
import {
  formatToolsToMarkdown,
  formatToolRoster,
  formatSkillRoster,
} from '@/server/utils/formatTools';

export class AgentService implements OnApplicationBootstrap {
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
    @Inject(ToolService) private readonly toolService: ToolService,
    @Inject(SkillService) private readonly skillService: SkillService,
  ) {}

  // 启动期预热：工具注册/skill 扫描/system prompt 渲染全是静态内容，
  // 惰性到首次 activate 会占用首连接的关键路径。fire-and-forget 不阻塞启动。
  onApplicationBootstrap(): void {
    void this.getSystemPrompt();
  }

  // 全局 conv agent 的 system prompt：内容固定，首次构建后 memoize（等价 buildSystemPrompt(buildToolSet())）。
  getSystemPrompt(): Promise<string> {
    if (!this.cachedPrompt) {
      this.cachedPrompt = (async () => {
        await Promise.all([
          this.toolService.initialize(),
          this.skillService.initialize(),
        ]);
        return await this.buildSystemPrompt(this.buildToolSet());
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
      ...inlineIds.map(id => ({
        id,
        mode: 'inline' as const,
        concurrency: this.toolService.resolve(id)?.config.concurrency,
      })),
      ...listedIds.map(id => ({
        id,
        mode: 'listed' as const,
        concurrency: this.toolService.resolve(id)?.config.concurrency,
      })),
    ];
    const skillIds = this.skillService
      .getCachedSkillIds()
      .filter(id => !excludeSet.has(id));
    return ToolSet.of(members, skillIds);
  }

  // 按 ToolSet 渲染 system prompt（per-run，conv 与子 agent 复用）。listed 工具与 skill
  // 以单行 roster 常驻——ReAct 信封无原生 function calling，名单常驻 + list_tools 按需展开。
  async buildSystemPrompt(
    toolSet: ToolSet,
    base = BASE_PROMPT,
  ): Promise<string> {
    const resolve = (id: string): Tool | undefined =>
      this.toolService.resolve(id);
    const inlineTools = toolSet
      .inlineIds()
      .map(resolve)
      .filter((t): t is Tool => t !== undefined);
    const listedTools = toolSet
      .listedIds()
      .map(resolve)
      .filter((t): t is Tool => t !== undefined);
    const skillIds = new Set(toolSet.skillIds());
    const skills = (await this.skillService.getAllSkillInfo()).filter(s =>
      skillIds.has(s.id),
    );

    const toolsSection = [
      formatToolsToMarkdown(inlineTools, { detail: true }),
      listedTools.length > 0
        ? `Other available tools (one line each — full parameters via \`list_tools tool=<id>\`):\n\n${formatToolRoster(listedTools)}`
        : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    const skillsText = base.get('Skills')?.content ?? '';
    const skillsSection =
      skills.length > 0
        ? `${skillsText}\n\nAvailable skills (load via \`skill_call\` with the id):\n\n${formatSkillRoster(skills)}`
        : skillsText;

    return base
      .insertBefore('Skills', 'Tools', toolsSection)
      .with('Skills', skillsSection)
      .build();
  }
}
