import type { JSONSchemaType } from 'ajv';
import type { UploadConfig } from '@/shared/types';
import { defineConfigFragment } from './config-fragment';

/**
 * 上传全局限额——FileController 校验时直取（不再回依赖 AgentService）。
 */
export const UPLOAD_LIMITS: UploadConfig = {
  maxSize: 10485760,
  allowedTypes: ['image/*', 'application/pdf', 'text/*'],
  maxCount: 5,
};

/**
 * upload 域的配置片段——文件上传限额（前端表单可改）。
 * 与 UPLOAD_LIMITS 同值；reactions：选中的 chat 模型非多模态时隐藏（依赖兄弟键 model.multimodal）。
 */
export const UPLOAD_FRAGMENT = defineConfigFragment({
  key: 'upload',
  schema: {
    type: 'object',
    nullable: true,
    properties: {
      maxSize: {
        type: 'number',
        default: UPLOAD_LIMITS.maxSize,
        nullable: true,
        description: 'Maximum file size in bytes (e.g. 10485760 = 10MB)',
      },
      allowedTypes: {
        type: 'array',
        items: { type: 'string' },
        default: UPLOAD_LIMITS.allowedTypes,
        nullable: true,
        description: 'Allowed MIME types (e.g. image/*, application/pdf)',
      },
      maxCount: {
        type: 'number',
        default: UPLOAD_LIMITS.maxCount,
        nullable: true,
        description: 'Maximum number of files per upload',
      },
    },
    // 仅多模态模型支持上传 → 选中模型非多模态时隐藏。
    reactions: [
      {
        when: { field: 'model.multimodal', op: 'eq', value: false },
        set: { visible: false },
      },
    ],
  } as unknown as JSONSchemaType<unknown>,
});
