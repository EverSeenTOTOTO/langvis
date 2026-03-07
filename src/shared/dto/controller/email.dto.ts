import { BaseDto, dto } from '../base';

// List emails request
export interface ListEmailsRequest {
  from?: string;
  subject?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
}

@dto<ListEmailsRequest>({
  type: 'object',
  properties: {
    from: { type: 'string', nullable: true },
    subject: { type: 'string', nullable: true },
    startDate: { type: 'string', format: 'date-time', nullable: true },
    endDate: { type: 'string', format: 'date-time', nullable: true },
    page: { type: 'integer', minimum: 1, nullable: true },
    pageSize: { type: 'integer', minimum: 1, maximum: 100, nullable: true },
  },
  additionalProperties: false,
})
export class ListEmailsRequestDto extends BaseDto implements ListEmailsRequest {
  from?: string;
  subject?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
}

// List emails response item
export interface EmailListItem {
  id: string;
  messageId: string;
  from: string;
  fromName: string | null;
  to: string;
  subject: string;
  sentAt: Date;
  receivedAt: Date;
  attachmentCount: number;
  attachmentNames: string[] | null;
  createdAt: Date;
}

// List emails response
export interface ListEmailsResponse {
  items: EmailListItem[];
  total: number;
  page: number;
  pageSize: number;
}

// Get email detail response
export interface EmailDetail {
  id: string;
  messageId: string;
  from: string;
  fromName: string | null;
  to: string;
  subject: string;
  content: string;
  sentAt: Date;
  receivedAt: Date;
  attachmentCount: number;
  attachmentNames: string[] | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

// Delete email request
export interface DeleteEmailRequest {
  id: string;
}

@dto<DeleteEmailRequest>({
  type: 'object',
  properties: {
    id: { type: 'string' },
  },
  required: ['id'],
  additionalProperties: false,
})
export class DeleteEmailRequestDto
  extends BaseDto
  implements DeleteEmailRequest
{
  id!: string;
}
