import type { JSONSchemaType } from 'ajv';
import type { ConfigFragment } from '../config-fragment';

export interface HistoryCompactionConfig {
  threshold: number;
  windowSize: number;
  /** 压缩用的 chat 模型；缺省回退本 run 模型 → 系统默认 chat。 */
  compactModelId?: string;
}

export const HISTORY_FRAGMENT: ConfigFragment<
  'history',
  HistoryCompactionConfig
> = {
  key: 'history',
  schema: {
    type: 'object',
    nullable: true,
    title: 'History Compaction',
    description: '会话历史压缩（超阈折叠历史为摘要 C）。省略即关。',
    properties: {
      threshold: {
        type: 'number',
        default: 0.95,
        minimum: 0.1,
        maximum: 0.95,
        description: '触发压缩的上下文用量比例',
      },
      windowSize: {
        type: 'integer',
        default: 10,
        minimum: 1,
        description: '折叠滑动窗口大小',
      },
      compactModelId: {
        type: 'string',
        format: 'model-select',
        modelType: 'chat',
        nullable: true,
        description: '压缩用的 chat 模型（缺省回退本 run 模型）',
      },
    },
  } as unknown as JSONSchemaType<unknown>,
};
