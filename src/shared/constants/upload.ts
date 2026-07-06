import type { UploadConfig } from '@/shared/dto/controller';

/**
 * 上传策略唯一真相源——服务端校验（FileService.validateUpload）、upload ConfigFragment 的 schema
 * 默认值、客户端附件 picker 的 accept 三方共同引用，杜绝副本漂移。按会话覆盖未启用前，全局以此为准。
 */
export const DEFAULT_UPLOAD_CONFIG: Required<UploadConfig> = {
  maxSize: 10 * 1024 * 1024,
  allowedTypes: ['image/*', 'audio/*', 'application/pdf', 'text/*'],
  maxCount: 5,
};
