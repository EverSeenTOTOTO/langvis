import type { JSONSchemaType } from 'ajv';
import type { ConfigFragment } from '../config-fragment';

/**
 * 运行期兜底阈值（liveness + cost 三道闸）。生产默认宽；eval 经 runtimeConfig 调小。
 * 三个旋钮各被一个 guard hook 消费：maxIterations→MaxIterationsHook、
 * maxTokenUsage→BudgetHook、stuckThreshold→StuckHook。
 */
export interface GuardConfig {
  /** 迭代（tick）上限——MaxIterationsHook 到此即强制收尾。生产 1000（纯 runaway 兜底）。 */
  maxIterations: number;
  /** 累计 token 成本上限——BudgetHook 累加 estimateTokens 到此即强制收尾。 */
  maxTokenUsage: number;
  /** 连续无新动作 tick 数——StuckHook 到此即判卡死强制收尾。 */
  stuckThreshold: number;
}

export const GUARD_FRAGMENT: ConfigFragment<'guard', GuardConfig> = {
  key: 'guard',
  schema: {
    type: 'object',
    nullable: true,
    default: {},
    title: 'Agent Run Guards',
    description:
      '运行期兜底：迭代上限 / 累计 token 上限 / 卡死阈值（连续无新动作 tick）',
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
        description: '累计 token 成本上限，到即强制收尾（BudgetHook）',
      },
      stuckThreshold: {
        type: 'integer',
        default: 5,
        minimum: 1,
        nullable: true,
        description: '连续无新动作 tick 数，到即判卡死强制收尾（StuckHook）',
      },
    },
  } as unknown as JSONSchemaType<unknown>,
};
