import type { JSONSchemaType } from 'ajv';
import type { ConfigFragment } from '../config-fragment';

// 工具审批模式（AuthorizationProvider 消费）。
export type ApprovalMode = 'default' | 'auto' | 'yolo';

export interface ApprovalConfig {
  mode: ApprovalMode;
}

export const APPROVAL_FRAGMENT: ConfigFragment<'approval', ApprovalConfig> = {
  key: 'approval',
  schema: {
    type: 'object',
    nullable: true,
    default: {},
    title: 'Approval',
    description:
      '工具审批模式：default=写类确认；auto=只读直放+写类确认；yolo=全部直放（grants 仍然生效）',
    properties: {
      mode: {
        type: 'string',
        enum: ['default', 'auto', 'yolo'],
        default: 'default',
        nullable: true,
        description:
          'default：Bash 分类器 safe/sensitive 现状；auto：read 类直放、写类走确认；yolo：全部直放',
      },
    },
    required: [],
  } as unknown as JSONSchemaType<unknown>,
};
