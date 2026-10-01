import { Inject } from '@nestjs/common';
import type {
  DocumentDetail,
  ListDocumentsResponse,
} from '@/shared/dto/controller/document.dto';
import { DocumentCategory } from '@/shared/entities/Document';
import { DOCUMENT_REPOSITORY } from '../document.di-tokens';
import type { DocumentRepositoryPort } from '../domain/port/document.repository.port';

export class DocumentService {
  constructor(
    @Inject(DOCUMENT_REPOSITORY)
    private readonly repo: DocumentRepositoryPort,
  ) {}

  async listDocuments(params: {
    keyword?: string;
    category?: DocumentCategory;
    startTime?: string;
    endTime?: string;
    page?: number;
    pageSize?: number;
  }): Promise<ListDocumentsResponse> {
    return this.repo.listDocuments(params);
  }

  async getDocumentById(id: string): Promise<DocumentDetail | null> {
    return this.repo.getDocumentById(id);
  }

  async deleteDocument(id: string): Promise<boolean> {
    return this.repo.deleteDocument(id);
  }
}
