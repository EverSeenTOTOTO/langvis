import {
  DocumentCategory,
  DocumentMetadata,
  DocumentSourceType,
} from '@/shared/entities/Document';
import { BaseDto, dto } from '../base';

// List documents request
export interface ListDocumentsRequest {
  keyword?: string;
  category?: DocumentCategory;
  startTime?: string;
  endTime?: string;
  page?: number;
  pageSize?: number;
}

@dto<ListDocumentsRequest>({
  type: 'object',
  properties: {
    keyword: { type: 'string', nullable: true },
    category: {
      type: 'string',
      enum: [
        'tech_blog',
        'social_media',
        'paper',
        'documentation',
        'news',
        'other',
      ],
      nullable: true,
    },
    startTime: { type: 'string', format: 'date-time', nullable: true },
    endTime: { type: 'string', format: 'date-time', nullable: true },
    page: { type: 'integer', minimum: 1, nullable: true },
    pageSize: { type: 'integer', minimum: 1, maximum: 100, nullable: true },
  },
  additionalProperties: false,
})
export class ListDocumentsRequestDto
  extends BaseDto
  implements ListDocumentsRequest
{
  keyword?: string;
  category?: DocumentCategory;
  startTime?: string;
  endTime?: string;
  page?: number;
  pageSize?: number;
}

// List documents response
export interface DocumentListItem {
  id: string;
  title: string;
  summary: string | null;
  keywords: string[];
  category: DocumentCategory;
  sourceType: DocumentSourceType | null;
  sourceUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ListDocumentsResponse {
  items: DocumentListItem[];
  total: number;
  page: number;
  pageSize: number;
}

// Get document detail response
export interface DocumentDetail {
  id: string;
  title: string;
  summary: string | null;
  keywords: string[];
  category: DocumentCategory;
  sourceType: DocumentSourceType | null;
  sourceUrl: string | null;
  rawContent: string;
  metadata: DocumentMetadata | null;
  chunkCount: number;
  createdAt: Date;
  updatedAt: Date;
}

// Delete document request
export interface DeleteDocumentRequest {
  id: string;
}

@dto<DeleteDocumentRequest>({
  type: 'object',
  properties: {
    id: { type: 'string' },
  },
  required: ['id'],
  additionalProperties: false,
})
export class DeleteDocumentRequestDto
  extends BaseDto
  implements DeleteDocumentRequest
{
  id!: string;
}
