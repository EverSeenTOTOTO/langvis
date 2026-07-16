import type { JSONSchemaType } from 'ajv';
import type { ConfigFragment } from '../config-fragment';

/**
 * pre-LLM 预算化无损落盘（offload）。每次 LLM 调用前测 token：
 * 超阈值时把最老的 user 消息载荷（Observation 或裸 user，如 email 正文）写盘、换桩，
 * 直到回 hardCap 内或无可桩。两阶段范围：A 阶段先桩 [base,len)（保供应商前缀缓存），
 * 耗尽仍超才 B 阶段回溯 [0,base) seed（溢出兜底）。keepRecent 为软偏好（非硬地板）。
 * 与 loop（有损 fold）相位分离：offload=pre-llm，compaction=post-observation。省略即关。
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
        description:
          '软偏好——耗尽优选区仍超 hardCap 才推到最近 N 条（非硬地板）',
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
