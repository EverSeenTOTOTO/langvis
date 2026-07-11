import type { JSONSchemaType } from 'ajv';
import type { ConfigFragment } from '../config-fragment';

export interface ModelConfig {
  modelId?: string;
  temperature?: number;
  topP?: number;
}

export const MODEL_FRAGMENT: ConfigFragment<'model', ModelConfig> = {
  key: 'model',
  schema: {
    type: 'object',
    nullable: true,
    title: 'Model',
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
};
