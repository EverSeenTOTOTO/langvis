import { tool } from '@/server/decorator/core';
import { input } from '@/server/decorator/param';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import type { AgentEvent, ToolConfig } from '@/shared/types';
import { container } from 'tsyringe';
import { Tool } from '..';
import { ExecutionContext } from '../../ExecutionContext';
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
    const prompt = this.buildAdvicePrompt(formData);

    const messages = [
      {
        role: 'system' as const,
        content: `你是一位专业的理财顾问助手。根据用户提供的资产状况、市场温度、风险偏好，给出仓位调整建议。

注意事项：
- 不提供具体的投资建议（不推荐具体股票代码）
- 建议仅供参考，不构成投资建议
- 始终强调风险管理的重要性
- 用清晰、结构化的方式表达建议

**关键任务**：
1. 根据用户提供的市场温度（1-10分）和个人情绪，评估用户设定的目标仓位是否合理
2. 如果目标仓位不合理（如市场温度很低但仓位过高，或市场温度高但仓位过低），给出更合理的仓位配置建议
3. 解释调整理由，帮助用户理解风险管理的重要性`,
      },
      {
        role: 'user' as const,
        content: prompt,
      },
    ];

    return yield* ctx.callLlm({ messages });
  }

  private buildAdvicePrompt(formData: Record<string, any>): string {
    const parts: string[] = ['请根据以下信息给出仓位调整建议：'];

    if (formData.totalAssets) {
      parts.push(`**总资产**: ${formData.totalAssets}`);
    }

    if (formData.currentPosition) {
      parts.push('\n**当前持仓**:');
      const cp = formData.currentPosition;
      if (cp.stocks) parts.push(`  - 股票: ${cp.stocks}`);
      if (cp.funds) parts.push(`  - 基金: ${cp.funds}`);
      if (cp.bonds) parts.push(`  - 债券: ${cp.bonds}`);
      if (cp.preciousMetals) parts.push(`  - 贵金属: ${cp.preciousMetals}`);
      if (cp.cash) parts.push(`  - 现金: ${cp.cash}`);
    }

    if (formData.marketTemperature) {
      parts.push(`\n**市场温度**: ${formData.marketTemperature}`);
    }

    if (formData.personalEmotion) {
      const emotionMap: Record<string, string> = {
        greedy: '贪婪',
        fearful: '恐惧',
        neutral: '中性',
        uncertain: '不确定',
      };
      parts.push(
        `\n**个人情绪**: ${emotionMap[formData.personalEmotion] || formData.personalEmotion}`,
      );
    }

    if (formData.targetPosition) {
      parts.push('\n**目标仓位**:');
      const tp = formData.targetPosition;
      if (tp.stocks) parts.push(`  - 股票: ${tp.stocks}`);
      if (tp.funds) parts.push(`  - 基金: ${tp.funds}`);
      if (tp.bonds) parts.push(`  - 债券: ${tp.bonds}`);
      if (tp.preciousMetals) parts.push(`  - 贵金属: ${tp.preciousMetals}`);
      if (tp.cash) parts.push(`  - 现金: ${tp.cash}`);
    }

    if (formData.stopLoss) {
      parts.push(`\n**止损设置**: ${formData.stopLoss}`);
    }

    if (formData.notes) {
      parts.push(`\n**备注**: ${formData.notes}`);
    }

    parts.push(
      '\n请给出具体的仓位调整建议，包括：',
      '1. 当前仓位分析',
      '2. 目标仓位合理性评估（是否合理，为什么）',
      '3. 更合理的仓位配置建议（如适用）',
      '4. 调整方向建议',
      '5. 风险提示',
    );

    return parts.join('\n');
  }
}
