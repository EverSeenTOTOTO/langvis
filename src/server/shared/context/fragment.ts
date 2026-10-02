import type { JSONSchemaType } from 'ajv';
import type { ConfigFragment } from '@/server/modules/conversation/domain/config/config-fragment';

// 上下文管理统一配置（合并原 loop/history/offload）。分层阶梯内建于小节：
// trim/microCompact 确定性 → runFold（run 域 LLM 折叠，默认开）→ convFold（会话域两层）。

export interface TrimSection {
  /** observation/assistant 满 trimAge 个 tick 后桩化落盘（无损、可回取）。默认 2。 */
  age?: number;
  /** 近窗口保护：末 keepRecent 条消息 trim/microCompact 都不碰。默认 4。 */
  keepRecent?: number;
}

export interface MicroCompactSection {
  /** 微压缩启用门槛：run 步数达此值才启用。默认 20。 */
  stepThreshold?: number;
  /** 仅满 compactAge 个 tick 的 observation 桩被有损丢弃。默认 8（须 > trim.age）。 */
  age?: number;
}

export interface RunFoldSection {
  /** 触发比例：run 工作集超 contextSize×此值即折叠较早 loop 动作。默认 0.95。 */
  threshold: number;
  /** 折叠滚动窗口大小（条/块）。默认 10。 */
  windowSize: number;
  /** 折叠后保留的末尾动作数。默认 4。 */
  keepRecent: number;
  /** 折叠模型；缺省回退本 run 模型 → 系统默认 chat。 */
  modelId?: string;
}

export interface ConvFoldSection {
  /** 选择性重构触发比例（低阈，保细节）：effective 超 contextSize×此值即截断较早长用户消息头部。默认 0.5。 */
  reconstructThreshold?: number;
  /** 选择性重构保留的末尾消息数。默认 4。 */
  reconstructKeepRecent?: number;
  /** 全对话摘要触发比例（高阈）：effective 超 contextSize×此值即折叠为摘要 C。默认 0.8。 */
  threshold: number;
  /** 折叠滚动窗口大小。 */
  windowSize: number;
  /** 折叠模型；缺省回退本 run 模型 → 系统默认 chat。 */
  modelId?: string;
}

export interface ContextConfig {
  trim?: TrimSection;
  microCompact?: MicroCompactSection;
  runFold?: RunFoldSection;
  convFold?: ConvFoldSection;
}

export const CONTEXT_FRAGMENT: ConfigFragment<'context', ContextConfig> = {
  key: 'context',
  schema: {
    type: 'object',
    nullable: true,
    // 对象层 default：runFold 默认开（防长 run 撑爆窗口）；确定性层/会话层省略即关。
    default: { runFold: { threshold: 0.95, windowSize: 10, keepRecent: 4 } },
    title: 'Context Management',
    description:
      '上下文管理统一配置（分层阶梯）：① trim/microCompact——run 域确定性桩化/丢桩（省略即关）；② runFold——run 域 LLM 折叠较早 loop 动作（默认开）；③ convFold——会话域重构截头 + 全对话摘要（省略即关）。',
    properties: {
      trim: {
        type: 'object',
        nullable: true,
        title: 'Trim',
        description:
          '裁剪（pre-LLM，无损）：aged 结果桩化落盘 + hint 标记，可 rg/sed 回取',
        properties: {
          age: {
            type: 'integer',
            default: 2,
            minimum: 0,
            nullable: true,
            description: '触发年龄（tick），默认 2',
          },
          keepRecent: {
            type: 'integer',
            default: 4,
            minimum: 0,
            nullable: true,
            description: '近窗口保护条数，默认 4',
          },
        },
      },
      microCompact: {
        type: 'object',
        nullable: true,
        title: 'Micro Compact',
        description:
          '微压缩（pre-LLM，有损）：步数达门槛后丢弃旧 observation 桩',
        properties: {
          stepThreshold: {
            type: 'integer',
            default: 20,
            minimum: 1,
            nullable: true,
            description: '启用门槛（run 步数），默认 20',
          },
          age: {
            type: 'integer',
            default: 8,
            minimum: 1,
            nullable: true,
            description: '丢弃年龄（tick），默认 8（须 > trim.age）',
          },
        },
      },
      runFold: {
        type: 'object',
        nullable: true,
        title: 'Run Fold',
        description: 'run 域 LLM 折叠：工作集超阈折叠较早 loop 动作、保留近期',
        properties: {
          threshold: {
            type: 'number',
            default: 0.95,
            minimum: 0.1,
            maximum: 0.99,
            nullable: true,
            description: '触发比例（窗口×），默认 0.95',
          },
          windowSize: {
            type: 'integer',
            default: 10,
            minimum: 1,
            nullable: true,
            description: '折叠滚动窗口大小，默认 10',
          },
          keepRecent: {
            type: 'integer',
            default: 4,
            minimum: 0,
            nullable: true,
            description: '折叠后保留末尾动作数，默认 4',
          },
          modelId: {
            type: 'string',
            nullable: true,
            description: '折叠模型；缺省回退本 run 模型 → 系统默认 chat',
          },
        },
      },
      convFold: {
        type: 'object',
        nullable: true,
        title: 'Conv Fold',
        description:
          '会话域两层压缩：① 重构截头（低阈保细节）② 全对话摘要 C（高阈，上下文趋近清空）',
        properties: {
          reconstructThreshold: {
            type: 'number',
            default: 0.5,
            minimum: 0.1,
            maximum: 0.99,
            nullable: true,
            description: '重构触发比例（低阈），默认 0.5',
          },
          reconstructKeepRecent: {
            type: 'integer',
            default: 4,
            minimum: 0,
            nullable: true,
            description: '重构保留末尾消息数，默认 4',
          },
          threshold: {
            type: 'number',
            default: 0.8,
            minimum: 0.1,
            maximum: 0.99,
            nullable: true,
            description: '全对话摘要触发比例（高阈），默认 0.8',
          },
          windowSize: {
            type: 'integer',
            default: 10,
            minimum: 1,
            nullable: true,
            description: '折叠滚动窗口大小，默认 10',
          },
          modelId: {
            type: 'string',
            nullable: true,
            description: '折叠模型；缺省回退本 run 模型 → 系统默认 chat',
          },
        },
      },
    },
  } as unknown as JSONSchemaType<unknown>,
};
