import type { JSONSchemaType } from 'ajv';
import { defineConfigFragment } from '@/server/libs/config/config-fragment';

export interface CompactionConfig {
  threshold: number;
  windowSize: number;
  /** loop 内压缩时保留的近期消息数（含成对的 action/observation）。 */
  keepRecent: number;
}

/**
 * compaction 配置片段——记忆压缩（历史层 + loop 内迭代层）。schema + read 双向闭环：
 * schema 供前端渲染、ajv `useDefaults` 回填；read 供消费方经 readConfigFragment 强类型取回。
 *
 * 无 `enabled` 硬开关——是否压缩由 threshold 兜底判定（用量超阈才折叠）。
 */
export const MEMORY_FRAGMENT = defineConfigFragment({
  key: 'memory',
  schema: {
    type: 'object',
    nullable: true,
    default: { compaction: {} },
    properties: {
      compaction: {
        type: 'object',
        nullable: true,
        default: {},
        description: '记忆压缩（历史层 + loop 内迭代层）',
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
      },
    },
  } as unknown as JSONSchemaType<unknown>,
  read: (cfg): CompactionConfig => {
    // parse() 已依 schema 的对象级 default 建出 memory.compaction 并回填默认值；
    // 此处直接强类型读取，缺失即 invariant 违例、应 fail loud。
    return (cfg as { memory: { compaction: CompactionConfig } }).memory
      .compaction;
  },
});
