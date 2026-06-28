import type { JSONSchemaType } from 'ajv';
import type { ModelConfig } from '@/shared/types';
import { defineConfigFragment } from '@/server/libs/config/config-fragment';

/**
 * model 域的配置片段——chat 模型选择（agent 域自有，与其他域 fragment 地位对等）。
 * model 整体可选（无对象级 default）：缺省时 executor 以默认模型运行。
 * ModelConfig 类型置于 shared/types，供 memory（历史压缩复用同模型）等域经
 * readConfigFragment 强类型读取，不引入对 agent 的源码依赖。
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
  read: (cfg): ModelConfig => {
    const model = (cfg as { model?: ModelConfig }).model;
    return model ?? {};
  },
});
