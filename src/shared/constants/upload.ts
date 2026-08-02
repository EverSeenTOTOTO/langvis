import type { UploadConfig } from '@/shared/dto/controller';

// 上传策略唯一真相源——服务端 / ConfigFragment schema 默认值 / 附件 picker 三方共用。
export const DEFAULT_UPLOAD_CONFIG: Required<UploadConfig> = {
  maxSize: 10 * 1024 * 1024,
  allowedTypes: ['image/*', 'audio/*', 'application/pdf', 'text/*'],
  maxCount: 5,
};
