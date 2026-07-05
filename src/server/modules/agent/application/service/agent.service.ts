import { container, inject, singleton } from 'tsyringe';
import type { JSONSchemaType } from 'ajv';
import { ToolIds } from '@/shared/constants';
import { parse } from '@/server/utils/schemaValidator';
import type { Tool } from '../../domain/model/tool.base';
import { RuntimeConfigVO } from '../../domain/model/runtime-config.vo';
import { ConfigValidationError } from '../../domain/errors';
import { composeConfigSchema } from '@/server/libs/config/config-fragment';
import { buildBasePrompt } from './base-prompt';
import { ToolService } from './tool.service';
import { SkillService } from './skill.service';

@singleton()
export class AgentService {
  private readonly inlineTools = [
    ToolIds.ASK_USER,
    ToolIds.RESPONSE_USER,
    ToolIds.CACHED_READ,
    ToolIds.SKILL_CALL,
    ToolIds.LIST_TOOLS,
  ];

  private cachedSchema: JSONSchemaType<Record<string, unknown>> | null = null;
  private cachedPrompt: Promise<string> | null = null;

  constructor(
    @inject(ToolService) private readonly toolService: ToolService,
    @inject(SkillService) private readonly skillService: SkillService,
  ) {}

  /**
   * 聚合所有 ConfigFragment（按 key 平铺）为对话配置 schema——纯组合器，不认识任何域细节。
   * 前端配置弹窗据此渲染，conv 侧 resolveConversationConfig 据此 parse runtimeConfig。
   */
  getConfigSchema(): JSONSchemaType<Record<string, unknown>> {
    if (!this.cachedSchema) {
      this.cachedSchema = composeConfigSchema() as JSONSchemaType<
        Record<string, unknown>
      >;
    }
    return this.cachedSchema;
  }

  /** 全局唯一 agent 的 system prompt——内容固定，构建一次后 memoize。首次调用触发动态 import 注册。 */
  getSystemPrompt(): Promise<string> {
    if (!this.cachedPrompt) this.cachedPrompt = this.doBuildPrompt();
    return this.cachedPrompt;
  }

  /** 校验 userConfig 并产出 RuntimeConfigVO（不可变配置快照）；失败抛 ConfigValidationError。 */
  createRunConfig(
    userConfig: Record<string, unknown>,
    systemPrompt: string,
    contextSize: number,
  ): RuntimeConfigVO {
    let runtimeConfig: Record<string, unknown>;

    try {
      runtimeConfig = parse(this.getConfigSchema(), userConfig);
    } catch (e) {
      throw new ConfigValidationError((e as Error)?.message ?? String(e));
    }

    return RuntimeConfigVO.of({
      systemPrompt,
      tools: this.inlineTools,
      contextSize,
      runtimeConfig,
    });
  }

  private async doBuildPrompt(): Promise<string> {
    await Promise.all([
      this.toolService.initialize(),
      this.skillService.initialize(),
    ]);

    const tools = this.inlineTools.map(t => container.resolve<Tool>(t));
    const inlineIds = new Set(tools.map(t => t.id));
    const otherToolIds = this.toolService
      .getCachedToolIds()
      .filter(id => !inlineIds.has(id));
    const skillIds = this.skillService.getCachedSkillIds();

    let prompt = buildBasePrompt(tools);
    if (otherToolIds.length > 0 || skillIds.length > 0) {
      prompt = prompt.insertAfter(
        'Skills',
        'Other Tools and Skills',
        [...otherToolIds, ...skillIds].join(', '),
      );
    }
    return prompt.build();
  }
}
