import type { JSONSchemaType } from 'ajv';
import type { ConfigFragment } from '../config-fragment';

// 会话级两层压缩：① 选择性重构消息组（低阈，保更多原始细节，in-memory 无损截断）；② 全对话摘要（高阈，折叠为 C，上下文趋近清空）。
export interface HistoryCompactionConfig {
  /** 选择性重构触发比例（低阈，默认 0.5）：effective 超 contextSize×此值即截断较早长用户消息头部。 */
  reconstructThreshold?: number;
  /** 选择性重构保留的末尾消息数（默认 4）：这之前的长用户消息被截断头部。 */
  reconstructKeepRecent?: number;
  /** 全对话摘要触发比例（高阈，默认 0.8）：effective 超 contextSize×此值即折叠为摘要 C。 */
  threshold: number;
  /** 全对话摘要折叠窗口大小。 */
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
    description:
      '会话历史两层压缩：① 选择性重构（reconstructThreshold 低阈）——保更多原始细节，截断较早长用户消息头部（in-memory，无持久化）；② 全对话摘要（threshold 高阈）——折叠历史为摘要 C，上下文趋近清空。省略即关。',
    properties: {
      reconstructThreshold: {
        type: 'number',
        default: 0.5,
        minimum: 0.1,
        maximum: 0.99,
        description:
          '选择性重构触发比例（默认 0.5）：effective 超 contextSize×此值即截断较早长用户消息头部',
      },
      reconstructKeepRecent: {
        type: 'integer',
        default: 4,
        minimum: 0,
        description: '选择性重构保留的末尾消息数（默认 4）',
      },
      threshold: {
        type: 'number',
        default: 0.8,
        minimum: 0.1,
        maximum: 0.99,
        description:
          '全对话摘要触发比例（默认 0.8）：effective 超即折叠为摘要 C',
      },
      windowSize: {
        type: 'integer',
        default: 10,
        minimum: 1,
        description: '全对话摘要折叠滑动窗口大小',
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
