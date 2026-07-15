import type { JSONSchemaType } from 'ajv';
import type { ConfigFragment } from '../config-fragment';

/**
 * pre-LLM 预算化无损落盘（offload）。post-observation hook 读此 fragment：
 * 超阈值时把最老的未桩化 Observation 载荷写盘、消息正文换桩（无损，可 cached_read/rg 取回），
 * 与 loop（有损 fold）正交——offload 先跑（import 序在前），无损优先于有损。省略即关。
 */
export interface OffloadConfig {
  threshold: number;
  keepRecent: number;
  /** 给模型输出预留的 token（hardCap = contextSize − responseReserve）。 */
  responseReserve: number;
  /** estimateTokens 低估补偿系数（实测 cl100k 对中文/JSON 低估 ~8%）；桩化判断 tokens×factor。缺省 1.1。 */
  estimateSafetyFactor?: number;
}

export const OFFLOAD_FRAGMENT: ConfigFragment<'offload', OffloadConfig> = {
  key: 'offload',
  schema: {
    type: 'object',
    nullable: true,
    title: 'Pre-LLM Offload',
    description:
      '上下文预算化无损落盘：超阈值时桩化最老 Observation 到盘（cached_read/rg 取回）。省略即关。',
    properties: {
      threshold: {
        type: 'number',
        default: 0.8,
        minimum: 0.1,
        maximum: 0.95,
        nullable: true,
        description: '触发桩化的上下文用量比例',
      },
      keepRecent: {
        type: 'integer',
        default: 4,
        minimum: 0,
        nullable: true,
        description: '不桩化的近期 Observation 条数（LRU 保护最近）',
      },
      responseReserve: {
        type: 'integer',
        default: 512,
        minimum: 0,
        nullable: true,
        description:
          '给模型输出预留的 token（hardCap = contextSize − reserve）',
      },
      estimateSafetyFactor: {
        type: 'number',
        default: 1.1,
        minimum: 1,
        nullable: true,
        description: 'estimateTokens 低估补偿系数（桩化判断 tokens×factor）',
      },
    },
  } as unknown as JSONSchemaType<unknown>,
};
