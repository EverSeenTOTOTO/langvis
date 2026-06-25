import type { JSONSchemaType } from 'ajv';
import { defineConfigFragment } from '@/server/libs/config/config-fragment';

/**
 * model 域的配置片段——chat 模型选择（agent 域自有，与其他域 fragment 地位对等）。
 * model 整体可选（无对象级 default）：缺省时 executor 以默认模型运行。
 */
export const MODEL_FRAGMENT = defineConfigFragment({
  key: 'model',
  schema: {
    type: 'object',
    nullable: true,
    properties: {
      modelId: {
        type: 'string',
        format: 'model-select',
        modelType: 'chat',
      },
      temperature: {
        type: 'number',
        default: 0.7,
        minimum: 0,
        maximum: 1,
        nullable: true,
      },
      topP: {
        type: 'number',
        default: 0.7,
        minimum: 0,
        maximum: 1,
        nullable: true,
      },
    },
    required: ['modelId'],
  } as unknown as JSONSchemaType<unknown>,
});
