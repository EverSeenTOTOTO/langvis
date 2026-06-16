import type { EmailEntity } from '@/shared/entities/Email';

export interface EmailListParams {
  from?: string;
  subject?: string;
  startDate?: string;
  endDate?: string;
  status?: 'unarchived' | 'archived';
  page?: number;
  pageSize?: number;
}

export interface EmailListResponse {
  items: EmailEntity[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateEmailData {
  messageId: string;
  from: string;
  fromName?: string | null;
  to: string;
  subject: string;
  sentAt: Date;
  receivedAt: Date;
  content: string;
  attachmentCount?: number;
  attachmentNames?: string[];
  raw?: Record<string, unknown>;
}

export interface InboundEmailResult {
  success: boolean;
  id?: string;
  error?: string;
}

export interface EmailRepositoryPort {
  list(params: EmailListParams): Promise<EmailListResponse>;

  getById(id: string): Promise<EmailEntity | null>;

  getByMessageId(messageId: string): Promise<EmailEntity | null>;

  existsByMessageId(messageId: string): Promise<boolean>;

  save(email: EmailEntity): Promise<EmailEntity>;

  deleteById(id: string): Promise<boolean>;

  updateStatus(id: string, status: 'unarchived' | 'archived'): Promise<boolean>;
}
