import { ToolConfig } from '@/shared/types';

export interface PositionAdjustInput {
  conversationId: string;
}

export interface PositionAdjustOutput {
  submitted: boolean;
  advice?: string;
}

export const config: ToolConfig<PositionAdjustInput, PositionAdjustOutput> = {
  name: 'Position Adjust Tool',
  description:
    'Collect user position data via form and generate position adjustment advice.',
  inputSchema: {
    type: 'object',
    properties: {
      conversationId: {
        type: 'string',
        description: 'The conversation ID for form submission',
      },
    },
    required: ['conversationId'],
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
    notes: {
      type: 'string',
      title: '备注',
    },
  },
};
