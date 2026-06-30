import type { JSONSchemaType } from 'ajv';
import { defineConfigFragment } from '@/server/libs/config/config-fragment';

export interface LoopCompactionConfig {
  threshold: number;
  windowSize: number;
  /** loop 内压缩时保留的近期消息数（含成对的 action/observation）。 */
  keepRecent: number;
}

/**
 * loop mid-loop 折叠参数（用量超阈时把较早的 loop actions 折叠为一条回顾、保留近期 keepRecent）。
 * 与 conv 的 history 层压缩解耦：两层 threshold/windowSize 独立可调；fold 原语在 libs/compaction。
 * 与 WorkingMemory 同居 domain/model 是为避免域→应用反向依赖（type-only import 无副作用，注册由 module 完成）。
 * 无 enabled 硬开关——是否压缩由 threshold 兜底判定。默认值唯一来源是 schema 的 default 关键字。
 */
export const LOOP_FRAGMENT = defineConfigFragment({
  key: 'loop',
  schema: {
    type: 'object',
    nullable: true,
    default: {},
    title: '迭代压缩',
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
});
