import { tool } from '@/server/decorator/core';
import { input } from '@/server/decorator/param';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import type { AgentEvent, ToolConfig } from '@/shared/types';
import { container } from 'tsyringe';
import { Tool } from '..';
import { ExecutionContext } from '../../ExecutionContext';
import { Prompt } from '../../PromptBuilder';
import HumanInTheLoopTool from '../HumanInTheLoop';
import type { PositionAdjustInput, PositionAdjustOutput } from './config';

@tool(ToolIds.POSITION_ADJUST)
export default class PositionAdjustTool extends Tool<
  PositionAdjustInput,
  PositionAdjustOutput
> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  async *call(
    @input() params: PositionAdjustInput,
    ctx: ExecutionContext,
  ): AsyncGenerator<AgentEvent, PositionAdjustOutput, void> {
    ctx.signal.throwIfAborted();

    const humanInputTool = container.resolve<HumanInTheLoopTool>(
      ToolIds.HUMAN_IN_THE_LOOP,
    );

    const { formSchema } = await import('./config');

    const humanInput = yield* humanInputTool.call(
      {
        conversationId: params.conversationId,
        message: '请填写以下仓位调整信息：',
        formSchema: formSchema as any,
      },
      ctx,
    );

    if (!humanInput.submitted || !humanInput.data) {
      return {
        submitted: false,
        advice: '用户取消了表单提交',
      };
    }

    const formData = humanInput.data;

    this.logger.info('持仓信息已收集，提交模型分析中……');

    const advice = yield* this.generateAdvice(formData, ctx);

    return {
      submitted: true,
      advice,
    };
  }

  private async *generateAdvice(
    formData: Record<string, any>,
    ctx: ExecutionContext,
  ): AsyncGenerator<AgentEvent, string, void> {
    const systemPrompt = Prompt.empty()
      .with(
        'Role & Goal',
        '你是一位专业的理财顾问助手。根据用户提供的资产状况、市场温度、风险偏好，给出仓位调整建议。',
      )
      .with(
        'Guidelines',
        `- 不提供具体的投资建议（不推荐具体股票代码）
- 建议仅供参考，不构成投资建议
- 始终强调风险管理的重要性
- 用清晰、结构化的方式表达建议`,
      )
      .with(
        'Key Tasks',
        `1. 根据用户提供的市场温度（1-10分）和个人情绪，评估用户设定的目标仓位是否合理
2. 如果目标仓位不合理（如市场温度很低但仓位过高，或市场温度高但仓位过低），给出更合理的仓位配置建议
3. 解释调整理由，帮助用户理解风险管理的重要性`,
      );

    const userPrompt = this.buildAdvicePrompt(formData);

    const messages = [
      { role: 'system' as const, content: systemPrompt.build() },
      { role: 'user' as const, content: userPrompt },
    ];

    return yield* ctx.callLlm({ messages });
  }

  private buildAdvicePrompt(formData: Record<string, any>): string {
    let prompt = Prompt.empty().with(
      'Request',
      '请根据以下信息给出仓位调整建议：',
    );

    if (formData.totalAssets) {
      prompt = prompt.with('总资产', formData.totalAssets);
    }

    if (formData.currentPosition) {
      const cp = formData.currentPosition;
      const items: string[] = [];
      if (cp.stocks) items.push(`股票: ${cp.stocks}`);
      if (cp.funds) items.push(`基金: ${cp.funds}`);
      if (cp.bonds) items.push(`债券: ${cp.bonds}`);
      if (cp.preciousMetals) items.push(`贵金属: ${cp.preciousMetals}`);
      if (cp.cash) items.push(`现金: ${cp.cash}`);
      if (items.length > 0) {
        prompt = prompt.with('当前持仓', items.join('\n'));
      }
    }

    if (formData.marketTemperature) {
      prompt = prompt.with('市场温度', String(formData.marketTemperature));
    }

    if (formData.personalEmotion) {
      const emotionMap: Record<string, string> = {
        greedy: '贪婪',
        fearful: '恐惧',
        neutral: '中性',
        uncertain: '不确定',
      };
      prompt = prompt.with(
        '个人情绪',
        emotionMap[formData.personalEmotion] || formData.personalEmotion,
      );
    }

    if (formData.targetPosition) {
      const tp = formData.targetPosition;
      const items: string[] = [];
      if (tp.stocks) items.push(`股票: ${tp.stocks}`);
      if (tp.funds) items.push(`基金: ${tp.funds}`);
      if (tp.bonds) items.push(`债券: ${tp.bonds}`);
      if (tp.preciousMetals) items.push(`贵金属: ${tp.preciousMetals}`);
      if (tp.cash) items.push(`现金: ${tp.cash}`);
      if (items.length > 0) {
        prompt = prompt.with('目标仓位', items.join('\n'));
      }
    }

    if (formData.stopLoss) {
      prompt = prompt.with('止损设置', formData.stopLoss);
    }

    if (formData.notes) {
      prompt = prompt.with('备注', formData.notes);
    }

    prompt = prompt.with(
      'Output Requirements',
      `请给出具体的仓位调整建议，包括：
1. 当前仓位分析
2. 目标仓位合理性评估（是否合理，为什么）
3. 更合理的仓位配置建议（如适用）
4. 调整方向建议
5. 风险提示`,
    );

    return prompt.build();
  }
}
