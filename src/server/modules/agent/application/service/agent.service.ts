import { container, inject, singleton } from 'tsyringe';
import type { JSONSchemaType } from 'ajv';
import { ToolIds } from '@/shared/constants';
import { parse } from '@/server/utils/schemaValidator';
import type { Tool } from '../../domain/model/tool.base';
import { ToolSet } from '../../domain/model/tool-set.vo';
import type { ToolMember } from '../../domain/model/tool-set.vo';
import { RunConfigVO } from '../../domain/model/run-config.vo';
import { ConfigValidationError } from '../../domain/errors';
import { configSchema, type ConversationConfig } from '@/server/libs/config';
import { BASE_PROMPT } from './base-prompt';
import { ToolService } from './tool.service';
import { SkillService } from './skill.service';
import { formatToolsToMarkdown } from '@/server/utils/formatTools';

@singleton()
export class AgentService {
  private readonly inlineTools = [
    ToolIds.ASK_USER,
    ToolIds.RESPONSE_USER,
    ToolIds.CACHED_READ,
    ToolIds.SKILL_CALL,
    ToolIds.LIST_TOOLS,
    ToolIds.CALL_SUBAGENTS,
  ];

  private cachedPrompt: Promise<string> | null = null;

  constructor(
    @inject(ToolService) private readonly toolService: ToolService,
    @inject(SkillService) private readonly skillService: SkillService,
  ) {}

  getConfigSchema(): JSONSchemaType<Record<string, unknown>> {
    return configSchema as JSONSchemaType<Record<string, unknown>>;
  }

  /**
   * 全局 conv agent 的 system prompt——内容固定，构建一次后 memoize。首次调用触发动态 import 注册。
   * 等价于 buildSystemPrompt(buildToolSet())（conv 默认全集）。
   */
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

  /** 校验 userConfig 并产出 RunConfigVO（不可变配置快照）；失败抛 ConfigValidationError。 */
  buildRunConfig(userConfig: Record<string, unknown>): RunConfigVO {
    let runtimeConfig: ConversationConfig;

    try {
      runtimeConfig = parse(
        this.getConfigSchema(),
        userConfig,
      ) as ConversationConfig;
    } catch (e) {
      throw new ConfigValidationError((e as Error)?.message ?? String(e));
    }

    return RunConfigVO.of({
      tools: this.inlineTools,
      runtimeConfig,
    });
  }

  /**
   * 从 conv 侧已 parse 的 runtimeConfig 直接产出 RunConfigVO——不再二次 parse。
   * contextSize 不参与（按需派生）。
   */
  buildResolvedRunConfig(runtimeConfig: ConversationConfig): RunConfigVO {
    return RunConfigVO.of({
      tools: this.inlineTools,
      runtimeConfig,
    });
  }

  /**
   * 构建一个 ToolSet：全集 = 已发现工具，inline/listed 分类沿用 inlineTools；
   * 可剔除指定 id（子 agent 派生用）。inline 成员保持 inlineTools 顺序、listed 保持发现顺序，
   * 保证 conv 默认 ToolSet 渲染出的提示与历史逐字节一致。
   */
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

  /**
   * 按 ToolSet 渲染 system prompt（per-run，conv 与子 agent 复用同一机制）。
   * inline 成员 → base 的工具文档段；listed + skills → "Other Tools and Skills" 列表。
   * base 默认 BASE_PROMPT；子 agent 传 SUBAGENT_PROMPT。
   */
  buildSystemPrompt(toolSet: ToolSet, base = BASE_PROMPT): string {
    const inlineTools = toolSet
      .inlineIds()
      .map(id => container.resolve<Tool>(id));
    const other = [...toolSet.listedIds(), ...toolSet.skillIds()];

    return base
      .insertBefore('Skills', 'Tools', formatToolsToMarkdown(inlineTools))
      .insertAfter('Skills', 'Other Tool and Skills', other.join(', '))
      .build();
  }
}
