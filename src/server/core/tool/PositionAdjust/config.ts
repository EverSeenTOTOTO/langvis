import { ToolConfig } from '@/shared/types';

export interface PositionAdjustInput {
  // No input required - conversationId is obtained from TraceContext
}

export interface PositionAdjustOutput {
  submitted: boolean;
  advice?: string;
}

export const config: ToolConfig<PositionAdjustInput, PositionAdjustOutput> = {
  name: 'Position Adjust Tool',
  description:
    'Collect user position data via form and generate position adjustment advice.',
  compression: 'skip',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
  outputSchema: {
    type: 'object',
    properties: {
      submitted: { type: 'boolean' },
      advice: { type: 'string', nullable: true },
    },
    required: ['submitted'],
  },
};

export const formSchema = {
  type: 'object',
  properties: {
    totalAssets: {
      type: 'string',
      title: '总资产',
      description: '例如: 50万, 100w',
    },
    investmentGoal: {
      type: 'string',
      title: '投资目标',
      enum: [
        { label: '短期收益（1年内）', value: 'short_term' },
        { label: '中期增值（1-3年）', value: 'mid_term' },
        { label: '长期增值（3年以上）', value: 'long_term' },
        { label: '资产保值', value: 'preserve' },
      ],
      default: 'mid_term',
    },
    riskTolerance: {
      type: 'string',
      title: '风险偏好',
      enum: [
        { label: '保守型（不愿亏损）', value: 'conservative' },
        { label: '稳健型（可接受小幅波动）', value: 'moderate' },
        { label: '平衡型（可接受中等波动）', value: 'balanced' },
        { label: '激进型（追求高收益）', value: 'aggressive' },
      ],
      default: 'moderate',
    },
    investmentExperience: {
      type: 'string',
      title: '投资经验',
      enum: [
        { label: '新手（1年以下）', value: 'beginner' },
        { label: '有一定经验（1-3年）', value: 'intermediate' },
        { label: '经验丰富（3年以上）', value: 'experienced' },
        { label: '专业投资者', value: 'professional' },
      ],
      default: 'intermediate',
    },
    currentPosition: {
      type: 'object',
      title: '当前持仓',
      properties: {
        stocks: {
          type: 'string',
          title: '股票',
          description: '例如: 5万, 20w',
        },
        funds: {
          type: 'string',
          title: '基金',
          description: '例如: 3万, 10w',
        },
        bonds: {
          type: 'string',
          title: '债券',
        },
        preciousMetals: {
          type: 'string',
          title: '贵金属',
        },
        cash: {
          type: 'string',
          title: '现金',
        },
      },
    },
    marketTemperature: {
      type: 'string',
      title: '市场温度',
      description: '整体市场情绪 (1-10，或描述如"偏悲观")',
      default: '5',
    },
    personalEmotion: {
      type: 'string',
      title: '个人情绪',
      enum: [
        { label: '贪婪', value: 'greedy' },
        { label: '恐惧', value: 'fearful' },
        { label: '中性', value: 'neutral' },
        { label: '不确定', value: 'uncertain' },
      ],
      default: 'neutral',
    },
    targetPosition: {
      type: 'object',
      title: '目标仓位',
      properties: {
        stocks: {
          type: 'string',
          title: '股票',
          description: '例如: 30%, 5万',
        },
        funds: {
          type: 'string',
          title: '基金',
          description: '例如: 20%, 3万',
        },
        bonds: {
          type: 'string',
          title: '债券',
        },
        preciousMetals: {
          type: 'string',
          title: '贵金属',
        },
        cash: {
          type: 'string',
          title: '现金',
        },
      },
    },
    stopLoss: {
      type: 'string',
      title: '止损设置',
      description: '例如: 招商银行 30元, 茅台 1500',
    },
    takeProfit: {
      type: 'string',
      title: '止盈目标',
      description: '例如: 整体收益20%, 个股涨幅50%',
    },
    liquidityNeeds: {
      type: 'string',
      title: '资金流动性需求',
      enum: [
        { label: '随时可能用钱', value: 'high' },
        { label: '半年内可能用钱', value: 'medium' },
        { label: '长期不用', value: 'low' },
      ],
      default: 'low',
    },
    notes: {
      type: 'string',
      title: '备注',
      description: '其他需要说明的情况',
    },
  },
};
