import type { JSONSchemaType } from 'ajv';
import type { ConfigFragment } from '../config-fragment';

/**
 * pre-LLM 体积护栏（offload）——纯 per-call 安全网，**不缩历史**，**总量/窗口空间口径**。
 * 与 QueryBudgetHook 无关：QueryBudgetHook 是 per-latest 单条口径（阈值在 guard.maxQuerySize），
 * 本 hook 是总量口径——当本次 query 的 token×factor > contextWindow×windowRatio（剩余空间不足）时，
 * 最胖优先桩化 [base,len) 内候选到盘（cached_read/rg 分块取回），直到缩进阈值内（无损落盘）。
 * 总量逼近窗口主要由 compaction（post-observation fold）缩；offload 是 compaction 之后的无损兜底，
 * 当 compaction 缩不下（read-slice 被 skip、base 自身超窗等）时才大量介入。
 * 旋钮：windowRatio（触发比例，默认 0.9）。estimateTokens 低估补偿系数固定（非旋钮）。
 * 省略本 fragment 即关 offload。与 loop（有损 fold）相位分离：offload=pre-llm，compaction=post-observation。
 */
export interface OffloadConfig {
  /** 总量触发比例：total×factor > contextWindow×windowRatio 即 offload 最胖。默认 0.9。 */
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
      'pre-LLM 无损体积护栏（总量/窗口口径）：total×factor > contextWindow×windowRatio 时最胖优先桩化到盘。与 QueryBudgetHook（per-latest，guard.maxQuerySize）无关。启用靠在场；省略即关 offload。',
    properties: {
      windowRatio: {
        type: 'number',
        default: 0.9,
        minimum: 0.1,
        maximum: 1,
        nullable: true,
        description:
          '总量触发比例（默认 0.9）：total×factor > contextWindow×此值即 offload 最胖',
      },
    },
  } as unknown as JSONSchemaType<unknown>,
};
