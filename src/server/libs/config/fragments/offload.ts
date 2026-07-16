import type { JSONSchemaType } from 'ajv';
import type { ConfigFragment } from '../config-fragment';

/**
 * pre-LLM 体积护栏（offload）——纯 per-call 安全网，**不缩历史**。两条独立触发：
 *   1. goal#1 不爆窗：total×factor > hardCap(=contextSize−responseReserve) 时，最胖优先桩化到 hardCap 内。
 *   2. goal#2 单 query 不被单条巨消息主导：任一 user/observation 正文 > contextSize×maxMessageSize
 *      即桩它自己（与总量无关）——大 observation 一进来就拆 chunk，单次调用不被一条主导，
 *      亦不触发"缩老历史→cached_read 取回→再桩"的页抖动。
 * 两阶段：[base,len) 优先（保供应商前缀缓存），耗尽仍超才回溯 [0,base) seed。keepRecent 为
 * goal#1 路径软偏好（per-message 路径不受约束——单条过大必须页）。省略即关。
 * 与 loop（有损 fold）相位分离：offload=pre-llm，compaction=post-observation。
 */
export interface OffloadConfig {
  /** 单条正文超过 contextSize × maxMessageSize 即桩（goal#2）。缺省 0.4。 */
  maxMessageSize: number;
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
      'pre-LLM 体积护栏：单条巨消息(>maxMessageSize)或总量逼近窗口(hardCap)时桩化到盘（cached_read/rg 分块取回）。省略即关。',
    properties: {
      maxMessageSize: {
        type: 'number',
        default: 0.4,
        minimum: 0.1,
        maximum: 0.95,
        nullable: true,
        description:
          '单条正文占上下文比例上限（goal#2：单 query 不被单条主导）',
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
