import type { JSONSchemaType } from 'ajv';
import type { ConfigFragment } from '../config-fragment';

export interface LoopCompactionConfig {
  threshold: number;
  windowSize: number;
  keepRecent: number;
}

export const LOOP_FRAGMENT: ConfigFragment<'loop', LoopCompactionConfig> = {
  key: 'loop',
  schema: {
    type: 'object',
    nullable: true,
    default: {},
    title: 'Loop Iteration Compaction',
    description: 'ReAct loop 内迭代压缩（超阈折叠较早步骤、保留近期）',
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
      keepRecent: {
        type: 'integer',
        default: 4,
        minimum: 0,
        nullable: true,
        description: 'loop 内压缩时保留的近期消息数',
      },
    },
  } as unknown as JSONSchemaType<unknown>,
};
