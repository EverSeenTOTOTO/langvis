import { tool } from '@/server/decorator/core';
import { input } from '@/server/decorator/param';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import type { AgentEvent, ToolConfig } from '@/shared/types';
import { container } from 'tsyringe';
import { wrapUntrusted } from '@/shared/utils';
import { Tool } from '..';
import { ExecutionContext } from '../../ExecutionContext';
import { Prompt } from '../../PromptBuilder';
import HumanInTheLoopTool from '../HumanInTheLoop';
import type { PositionAdjustInput, PositionAdjustOutput } from './config';

@tool(ToolIds.POSITION_ADJUSTMENT_ADVICE)
export default class PositionAdjustTool extends Tool<
  PositionAdjustInput,
  PositionAdjustOutput
> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  async *call(
    @input() _params: PositionAdjustInput,
    ctx: ExecutionContext,
  ): AsyncGenerator<AgentEvent, PositionAdjustOutput, void> {
    ctx.signal.throwIfAborted();

    const humanInputTool = container.resolve<HumanInTheLoopTool>(
      ToolIds.ASK_USER,
    );

    const { formSchema } = await import('./config');

    const humanInput = yield* humanInputTool.call(
      {
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

    this.logger.info('持仓信息已收集，提交模型分析中：', formData);

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
        'User Context',
        '用户是一位理性投资者，只会参考你的意见做出最终决策。请给出明确、可操作的建议，而不是模棱两可的说法。',
      )
      .with(
        'Guidelines',
        `- 不提供具体的投资建议（不推荐具体股票代码）
- 建议仅供参考，不构成投资建议
- 始终强调风险管理的重要性
- 给出明确的操作方向建议：买入/卖出/持有，并说明理由`,
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
      prompt = prompt.with(
        '总资产',
        wrapUntrusted(String(formData.totalAssets)),
      );
    }

    if (formData.investmentGoal) {
      const goalMap: Record<string, string> = {
        short_term: '短期收益（1年内）',
        mid_term: '中期增值（1-3年）',
        long_term: '长期增值（3年以上）',
        preserve: '资产保值',
      };
      prompt = prompt.with(
        '投资目标',
        goalMap[formData.investmentGoal] || formData.investmentGoal,
      );
    }

    if (formData.riskTolerance) {
      const riskMap: Record<string, string> = {
        conservative: '保守型（不愿亏损）',
        moderate: '稳健型（可接受小幅波动）',
        balanced: '平衡型（可接受中等波动）',
        aggressive: '激进型（追求高收益）',
      };
      prompt = prompt.with(
        '风险偏好',
        riskMap[formData.riskTolerance] || formData.riskTolerance,
      );
    }

    if (formData.investmentExperience) {
      const expMap: Record<string, string> = {
        beginner: '新手（1年以下）',
        intermediate: '有一定经验（1-3年）',
        experienced: '经验丰富（3年以上）',
        professional: '专业投资者',
      };
      prompt = prompt.with(
        '投资经验',
        expMap[formData.investmentExperience] || formData.investmentExperience,
      );
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
      prompt = prompt.with(
        '止损设置',
        wrapUntrusted(String(formData.stopLoss)),
      );
    }

    if (formData.takeProfit) {
      prompt = prompt.with(
        '止盈目标',
        wrapUntrusted(String(formData.takeProfit)),
      );
    }

    if (formData.liquidityNeeds) {
      const liqMap: Record<string, string> = {
        high: '随时可能用钱',
        medium: '半年内可能用钱',
        low: '长期不用',
      };
      prompt = prompt.with(
        '资金流动性需求',
        liqMap[formData.liquidityNeeds] || formData.liquidityNeeds,
      );
    }

    if (formData.notes) {
      prompt = prompt.with('备注', wrapUntrusted(String(formData.notes)));
    }

    prompt = prompt.with(
      'Output Requirements',
      `请给出明确的仓位调整建议，包括：
1. **操作方向**：明确指出每个资产类别的操作建议（买入/卖出/持有），不要说模棱两可的话
2. **当前仓位分析**：评估当前仓位配置是否合理
3. **目标仓位评估**：用户设定的目标是否合理，为什么
4. **具体调整建议**：如果不合理，给出更合理的配置建议
5. **风险提示**：潜在风险及应对措施

注意：用户是理性投资者，只会参考你的意见。请直接给出判断，不要用"建议考虑"、"可能需要"等模糊表述。`,
    );

    return prompt.build();
  }
}
