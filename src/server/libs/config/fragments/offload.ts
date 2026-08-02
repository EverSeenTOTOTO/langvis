import type { JSONSchemaType } from 'ajv';
import type { ConfigFragment } from '../config-fragment';

/** offload 体积护栏：两层——post-observation 逐条大小桩 + pre-LLM 总量压力桩（共用 offload/stubContent）。 */
export interface OffloadConfig {
  /** 总量触发比例，默认 0.8。pre-LLM OffloadHook 用。 */
  windowRatio?: number;
  // 产出即桩比例，默认 0.2：单条 Observation 超 contextSize×此值即落盘。大窗口放宽（小结构化输出不落盘），outputTokenThreshold 可绝对覆盖。
  outputSizeRatio?: number;
  /** 产出即桩绝对阈值覆盖（token 估算）。设则忽略 outputSizeRatio，用此写死值；省略走动态比例。 */
  outputTokenThreshold?: number;
}

export const OFFLOAD_FRAGMENT: ConfigFragment<'offload', OffloadConfig> = {
  key: 'offload',
  schema: {
    type: 'object',
    nullable: true,
    default: {},
    title: 'Offload',
    description:
      '体积护栏两层：① post-observation 逐条——单条 Observation 超 contextSize×outputSizeRatio 即落盘（产出即桩，动态跟随窗口）；② pre-LLM 总量——total×factor > contextWindow×windowRatio 时最胖优先桩化到盘。省略即两层全关。',
    properties: {
      windowRatio: {
        type: 'number',
        default: 0.8,
        minimum: 0.1,
        maximum: 1,
        nullable: true,
        description: 'pre-LLM 总量触发比例（默认 0.8）',
      },
      outputSizeRatio: {
        type: 'number',
        default: 0.2,
        minimum: 0.01,
        maximum: 1,
        nullable: true,
        description:
          'post-observation 产出即桩比例（默认 0.2）。单条 Observation 超 contextSize×此值即落盘；大窗口放宽、小窗口收紧。',
      },
      outputTokenThreshold: {
        type: 'number',
        default: null,
        minimum: 0,
        nullable: true,
        description:
          '产出即桩绝对阈值覆盖（token 估算）。设则忽略 outputSizeRatio；省略走动态比例。0=关闭产出即桩。',
      },
    },
  } as unknown as JSONSchemaType<unknown>,
};
