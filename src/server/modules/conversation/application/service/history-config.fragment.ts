import type { JSONSchemaType } from 'ajv';
import { defineConfigFragment } from '@/server/libs/config/config-fragment';

export interface HistoryCompactionConfig {
  threshold: number;
  windowSize: number;
}

/**
 * 历史层压缩配置片段——conv 域 ConversationMemory.compact 的 post-turn 折叠参数（有效历史用量超阈时
 * 把「上一个摘要 C + tail」滚动折叠成新 C）。与 agent 的 loop 迭代压缩解耦：两层 threshold/windowSize
 * 独立可调。fold 原语在 libs/compaction，配置无关。
 *
 * 默认值唯一来源是 schema 的 default 关键字；消费方假定 runtimeConfig 已被上游 parse
 * （resolveConversationConfig 经 composeConfigSchema + useDefaults 回填）。无 enabled 硬开关——
 * 是否压缩由 threshold 兜底判定。
 */
export const HISTORY_FRAGMENT = defineConfigFragment({
  key: 'history',
  schema: {
    type: 'object',
    nullable: true,
    default: {},
    title: '历史压缩',
    description: '会话历史压缩（超阈折叠历史为摘要 C）',
    properties: {
      threshold: {
        type: 'number',
        default: 0.8,
        minimum: 0.1,
        maximum: 0.95,
        nullable: true,
        description: '触发压缩的上下文用量比例',
      },
      windowSize: {
        type: 'integer',
        default: 10,
        minimum: 1,
        nullable: true,
        description: '折叠滑动窗口大小',
      },
    },
  } as unknown as JSONSchemaType<unknown>,
});
