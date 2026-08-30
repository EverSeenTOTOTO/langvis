import type { JSONSchemaType } from 'ajv';
import type { ConfigFragment } from '../config-fragment';

// offload 体积护栏：两层——裁剪（age 驱动，无损落盘 + hint 桩）+ 微压缩（步数驱动，有损丢弃旧桩）。共用 offload-stub。
export interface OffloadConfig {
  /** 裁剪：observation/assistant 满 trimAge 个 tick 后桩化落盘（无损、可回取）。默认 2。 */
  trimAge?: number;
  /** 微压缩触发门槛：run 步数（[base,len) 内 Observation 数）达此值才启用。默认 20。 */
  compactStepThreshold?: number;
  /** 微压缩：仅满 compactAge 个 tick 的 observation 桩被有损丢弃。默认 8。须 > trimAge。 */
  compactAge?: number;
  /** 近窗口保护：末 keepRecent 条消息裁剪/微压缩都不碰。默认 4。 */
  keepRecent?: number;
}

export const OFFLOAD_FRAGMENT: ConfigFragment<'offload', OffloadConfig> = {
  key: 'offload',
  schema: {
    type: 'object',
    nullable: true,
    default: {},
    title: 'Offload',
    description:
      '体积护栏两层：① 裁剪（pre-LLM）——observation/assistant 满 trimAge 个 tick 即桩化落盘（无损、可 rg/sed 回取），低价值结果以 hint 文本标记；② 微压缩（pre-LLM）——run 步数达 compactStepThreshold 后，满 compactAge 个 tick 且未被后续 bash 回取的 observation 桩有损丢弃以减负。省略即两层全关。',
    properties: {
      trimAge: {
        type: 'integer',
        default: 2,
        minimum: 0,
        nullable: true,
        description:
          '裁剪触发年龄（tick）；observation/assistant 满此年龄即桩化（默认 2）',
      },
      compactStepThreshold: {
        type: 'integer',
        default: 20,
        minimum: 1,
        nullable: true,
        description: '微压缩启用门槛：run 步数达此值才丢弃旧桩（默认 20）',
      },
      compactAge: {
        type: 'integer',
        default: 8,
        minimum: 1,
        nullable: true,
        description:
          '微压缩丢弃年龄（tick）；仅满此年龄的 observation 桩被丢弃（默认 8，须 > trimAge）',
      },
      keepRecent: {
        type: 'integer',
        default: 4,
        minimum: 0,
        nullable: true,
        description:
          '近窗口保护：末 keepRecent 条消息裁剪/微压缩都不碰（默认 4）',
      },
    },
  } as unknown as JSONSchemaType<unknown>,
};
