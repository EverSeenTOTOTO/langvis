import type { JSONSchemaType } from 'ajv';
import type { ConfigFragment } from '../config-fragment';

/**
 * 运行期兜底阈值（liveness + cost + per-message 闸）。生产默认宽；eval 经 runtimeConfig 调小。
 * 旋钮各被一个 guard hook 消费：maxIterations→MaxIterationsHook、
 * maxTokenUsage→CumulativeBudgetHook（累计口径）、stuckThreshold→StuckHook、
 * maxQuerySize/maxQueryTokens→QueryBudgetHook（per-latest 单条口径，与 offload 无关）。
 * offload 的总量/窗口阈值在 offload fragment（windowRatio），不在此。
 */
export interface GuardConfig {
  /** 迭代（tick）上限——MaxIterationsHook 到此即强制收尾。生产 1000（纯 runaway 兜底）。 */
  maxIterations: number;
  /** 累计 token 成本上限——CumulativeBudgetHook 累加 estimateTokens 到此即强制收尾。 */
  maxTokenUsage: number;
  /** 连续无新动作 tick 数——StuckHook 到此即判卡死强制收尾。 */
  stuckThreshold: number;
  /** 单条消息占 contextWindow 的比例上限（per-latest 口径，默认 0.4）——QueryBudgetHook 超即 drop 最新一条。
   *  与 offload 无关：offload 是总量/窗口口径，阈值在 offload.fragment.windowRatio。 */
  maxQuerySize?: number;
  /** 单条消息 token 绝对上限（默认 10000）——QueryBudgetHook 在大 context 上拦病态胖取。取 min 与比例值。 */
  maxQueryTokens?: number;
}

export const GUARD_FRAGMENT: ConfigFragment<'guard', GuardConfig> = {
  key: 'guard',
  schema: {
    type: 'object',
    nullable: true,
    default: {},
    title: 'Agent Run Guards',
    description:
      '运行期兜底：迭代上限 / 累计 token 上限 / 卡死阈值 / 单条消息体积上限（QueryBudgetHook；offload 总量阈值见 offload fragment）',
    properties: {
      maxIterations: {
        type: 'integer',
        default: 1000,
        minimum: 1,
        nullable: true,
        description: '迭代 tick 上限，到即强制收尾（MaxIterationsHook）',
      },
      maxTokenUsage: {
        type: 'integer',
        default: 1_000_000,
        minimum: 1,
        nullable: true,
        description:
          '累计 token 成本上限，到即强制收尾（CumulativeBudgetHook）',
      },
      stuckThreshold: {
        type: 'integer',
        default: 5,
        minimum: 1,
        nullable: true,
        description: '连续无新动作 tick 数，到即判卡死强制收尾（StuckHook）',
      },
      maxQuerySize: {
        type: 'number',
        default: 0.4,
        minimum: 0.1,
        maximum: 1,
        nullable: true,
        description:
          '单条消息占 contextWindow 的比例上限（默认 0.4，QueryBudgetHook per-latest）',
      },
      maxQueryTokens: {
        type: 'integer',
        default: 10_000,
        minimum: 1,
        nullable: true,
        description:
          '单条消息 token 绝对上限（默认 10000，QueryBudgetHook）；取 min 与比例值',
      },
    },
  } as unknown as JSONSchemaType<unknown>,
};
