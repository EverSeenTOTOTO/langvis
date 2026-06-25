import type { JSONSchemaType } from 'ajv';
import { defineConfigFragment } from '@/server/libs/config/config-fragment';

export interface CompactionConfig {
  enabled: boolean;
  threshold: number;
  windowSize: number;
  /** loop 内压缩时保留的近期消息数（含成对的 action/observation）。 */
  keepRecent: number;
}

/**
 * memory 域的配置片段——记忆压缩（历史层 + loop 内迭代层）。
 *
 * 默认值全在 schema 里：对象级 `default` 让 ajv `useDefaults` 在 parse 时建出
 * memory.compaction 嵌套结构，叶子级 `default` 回填具体值。前端 SchemaField 同源读 initialValue。
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
          enabled: {
            type: 'boolean',
            default: true,
            nullable: true,
            description: '启用记忆压缩',
          },
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
});

/**
 * 从 runtimeConfig 读取压缩配置。parse() 已依 schema 的对象级 default 建出
 * memory.compaction 并回填默认值，故此处直接强类型读取；缺失即 invariant 违例、应 fail loud。
 */
export function readCompactionConfig(
  runtimeConfig: Record<string, unknown>,
): CompactionConfig {
  return (runtimeConfig as { memory: { compaction: CompactionConfig } }).memory
    .compaction;
}
