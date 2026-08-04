import type { JSONSchemaType } from 'ajv';
import type { ConfigFragment } from '../config-fragment';

/** ReAct loop 内有损压缩（fold）：超 threshold 折较早步骤为过程摘要、保留 keepRecent 条尾。默认开（对象层 default，防小窗口 run 撑爆窗口）。 */
export interface LoopCompactionConfig {
  threshold: number;
  windowSize: number;
  keepRecent: number;
  /** 压缩用的 chat 模型；缺省回退本 run 模型 → 系统默认 chat。 */
  compactModelId?: string;
}

export const LOOP_FRAGMENT: ConfigFragment<'loop', LoopCompactionConfig> = {
  key: 'loop',
  schema: {
    type: 'object',
    // 对象层 default：缺省会话也让 loop 压缩默认开（否则 ajv 不填子字段 → CompactionHook 永不折）。
    default: { threshold: 0.95, windowSize: 10, keepRecent: 4 },
    nullable: true,
    title: 'Loop Iteration Compaction',
    description:
      'ReAct loop 内迭代压缩（超阈折叠较早步骤、保留近期）。默认开。',
    properties: {
      threshold: {
        type: 'number',
        default: 0.95,
        minimum: 0.1,
        maximum: 0.99,
        nullable: true,
        description:
          '触发有损压缩的上下文用量比例（默认 0.95，退为 offload 之后的兜底）',
      },
      windowSize: {
        type: 'integer',
        default: 10,
        minimum: 1,
        nullable: true,
        description: '折叠滑动窗口大小',
      },
      keepRecent: {
        type: 'integer',
        default: 4,
        minimum: 0,
        nullable: true,
        description: 'loop 内压缩时保留的近期消息数',
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
