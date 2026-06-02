import type {
  DocumentDetail,
  ListDocumentsResponse,
} from '@/shared/dto/controller/document.dto';
import { DocumentCategory } from '@/shared/entities/Document';

export interface DocumentRepositoryPort {
  listDocuments(params: {
    keyword?: string;
    category?: DocumentCategory;
    startTime?: string;
    endTime?: string;
    page?: number;
    pageSize?: number;
  }): Promise<ListDocumentsResponse>;

  getDocumentById(id: string): Promise<DocumentDetail | null>;

  deleteDocument(id: string): Promise<boolean>;
}
