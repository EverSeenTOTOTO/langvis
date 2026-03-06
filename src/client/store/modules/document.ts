import { api, ApiRequest } from '@/client/decorator/api';
import { store } from '@/client/decorator/store';
import type {
  DocumentDetail,
  ListDocumentsRequest,
  ListDocumentsResponse,
} from '@/shared/dto/controller/document.dto';
import { DocumentCategory } from '@/shared/entities/Document';
import { makeAutoObservable } from 'mobx';

@store()
export class DocumentStore {
  documents: ListDocumentsResponse = {
    items: [],
    total: 0,
    page: 1,
    pageSize: 10,
  };

  currentDocument: DocumentDetail | null = null;

  // Filter state
  keyword: string = '';
  category: DocumentCategory | undefined = undefined;
  startTime: string | undefined = undefined;
  endTime: string | undefined = undefined;

  constructor() {
    makeAutoObservable(this);
  }

  setKeyword(keyword: string) {
    this.keyword = keyword;
  }

  setCategory(category: DocumentCategory | undefined) {
    this.category = category;
  }

  setTimeRange(startTime: string | undefined, endTime: string | undefined) {
    this.startTime = startTime;
    this.endTime = endTime;
  }

  resetFilters() {
    this.keyword = '';
    this.category = undefined;
    this.startTime = undefined;
    this.endTime = undefined;
  }

  @api('/api/documents')
  async listDocuments(
    _params?: ListDocumentsRequest,
    req?: ApiRequest<ListDocumentsRequest>,
  ): Promise<ListDocumentsResponse | undefined> {
    const result = await req!.send();
    if (result) {
      this.documents = result as ListDocumentsResponse;
    }
    return result as ListDocumentsResponse | undefined;
  }

  @api((req: { id: string }) => `/api/documents/${req.id}`)
  async getDocumentById(
    _params: { id: string },
    req?: ApiRequest<{ id: string }>,
  ): Promise<DocumentDetail | undefined> {
    const result = await req!.send();
    if (result) {
      this.currentDocument = result as DocumentDetail;
    }
    return result as DocumentDetail | undefined;
  }

  @api((req: { id: string }) => `/api/documents/${req.id}`, {
    method: 'delete',
  })
  async deleteDocument(
    _params: { id: string },
    req?: ApiRequest<{ id: string }>,
  ): Promise<boolean> {
    const result = await req!.send();
    return result !== undefined;
  }
}
