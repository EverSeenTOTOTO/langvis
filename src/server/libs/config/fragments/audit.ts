import type { JSONSchemaType } from 'ajv';
import type { ConfigFragment } from '../config-fragment';

/**
 * post-LLM 答复审计：agent 调 response_user 时，另起一个独立上下文的审计子 run
 * 复算校验答复是否站得住（反幻觉）。`enabled` 显式开关（默认关）——须显式 opt-in，
 * 不能仅靠 fragment 存在与否（ajv `default:{}` 会让省略时仍得到 `{}` 对象）。
 * 子 run 的 runtimeConfig 会被剥掉本 fragment（防递归：审计不再审计自己）。
 */
export interface AuditConfig {
  /** 显式开关。默认关；须显式 true 才启用审计。 */
  enabled?: boolean;
  /** 单 run 内最多否决次数，到即强制放行（防无限循环）。默认 2。 */
  maxRejections?: number;
  /** 审计子 run 专用模型（可选，填更强的模型复算更可靠）；缺省回退对话主模型。 */
  auditModelId?: string;
}

export const AUDIT_FRAGMENT: ConfigFragment<'audit', AuditConfig> = {
  key: 'audit',
  schema: {
    type: 'object',
    nullable: true,
    default: {},
    title: 'Post-LLM Response Audit',
    description:
      'post-LLM 答复审计：agent 调 response_user 时另起独立审计子 run 复算校验（反幻觉）。须 enabled:true 显式开启。',
    properties: {
      enabled: {
        type: 'boolean',
        default: false,
        nullable: true,
        description: '显式开关，默认关；须 true 才启用审计。',
      },
      maxRejections: {
        type: 'integer',
        default: 2,
        minimum: 0,
        nullable: true,
        description:
          '单 run 内最多否决次数，到即强制放行（防无限循环，默认 2）',
      },
      auditModelId: {
        type: 'string',
        nullable: true,
        description: '审计子 run 专用模型（可选，缺省回退对话主模型）',
      },
    },
  } as unknown as JSONSchemaType<unknown>,
};
