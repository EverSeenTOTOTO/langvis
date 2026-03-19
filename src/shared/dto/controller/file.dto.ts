import { BaseDto, dto } from '../base';

export interface ListFilesRequest {
  page?: number;
  pageSize?: number;
  dir?: string;
}

@dto<ListFilesRequest>({
  type: 'object',
  properties: {
    page: { type: 'integer', minimum: 1, nullable: true },
    pageSize: { type: 'integer', minimum: 1, maximum: 100, nullable: true },
    dir: { type: 'string', nullable: true },
  },
  additionalProperties: false,
})
export class ListFilesRequestDto extends BaseDto implements ListFilesRequest {
  page?: number;
  pageSize?: number;
  dir?: string;
}

export interface FileListItem {
  filename: string;
  size: number;
  mimeType: string;
  createdAt: Date;
  url: string;
  isDir?: boolean;
}

export interface ListFilesResponse {
  items: FileListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UploadFileResponse {
  filename: string;
  url: string;
  size: number;
  mimeType: string;
}

export interface DeleteFileRequest {
  filename: string;
}

@dto<DeleteFileRequest>({
  type: 'object',
  properties: {
    filename: { type: 'string' },
  },
  required: ['filename'],
  additionalProperties: false,
})
export class DeleteFileRequestDto extends BaseDto implements DeleteFileRequest {
  filename!: string;
}

export interface UploadConfig {
  /** Maximum file size in bytes */
  maxSize?: number;
  /** Allowed MIME types, e.g. ['image/*', 'application/pdf'] */
  allowedTypes?: string[];
  /** Maximum number of files per upload */
  maxCount?: number;
}
