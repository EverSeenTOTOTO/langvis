import type { JSONSchemaType } from 'ajv';
import type { ConfigFragment } from '../config-fragment';

/** pre-LLM 无损体积护栏：token×factor > contextWindow×windowRatio 时最胖优先桩化 [base,len) 到盘。 */
export interface OffloadConfig {
  /** 总量触发比例，默认 0.8。 */
  windowRatio?: number;
}

export const OFFLOAD_FRAGMENT: ConfigFragment<'offload', OffloadConfig> = {
  key: 'offload',
  schema: {
    type: 'object',
    nullable: true,
    default: {},
    title: 'Pre-LLM Offload',
    description:
      'pre-LLM 无损体积护栏：total×factor > contextWindow×windowRatio 时最胖优先桩化到盘。省略即关。',
    properties: {
      windowRatio: {
        type: 'number',
        default: 0.8,
        minimum: 0.1,
        maximum: 1,
        nullable: true,
        description: '总量触发比例（默认 0.8）',
      },
    },
  } as unknown as JSONSchemaType<unknown>,
};
