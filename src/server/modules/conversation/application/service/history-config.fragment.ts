import type { JSONSchemaType } from 'ajv';
import { defineConfigFragment } from '@/server/libs/config/config-fragment';

export interface HistoryCompactionConfig {
  threshold: number;
  windowSize: number;
}

/**
 * 历史层压缩配置片段——conv 域 CompactTransform 的 post-turn 折叠参数（有效历史用量超阈时
 * 把「上一个摘要 C + tail」滚动折叠成新 C）。
 */
export const HISTORY_FRAGMENT = defineConfigFragment({
  key: 'history',
  schema: {
    type: 'object',
    nullable: true,
    default: {},
    title: 'History Compaction',
    description: '会话历史压缩（超阈折叠历史为摘要 C）',
    properties: {
      threshold: {
        type: 'number',
        default: 0.8,
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
    },
  } as unknown as JSONSchemaType<unknown>,
});
