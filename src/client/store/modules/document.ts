import { api, ApiRequest } from '@/client/decorator/api';
import { store } from '@/client/decorator/store';
import type {
  DocumentDetail,
  ListDocumentsRequest,
  ListDocumentsResponse,
} from '@/shared/dto/controller/document.dto';
import { makeAutoObservable } from 'mobx';

@store()
export class DocumentStore {
  items: ListDocumentsResponse['items'] = [];
  total = 0;
  loading = false;

  currentDocument: DocumentDetail | null = null;

  constructor() {
    makeAutoObservable(this);
  }

  @api('/api/documents')
  async list(
    _params?: ListDocumentsRequest,
    req?: ApiRequest<ListDocumentsRequest>,
  ): Promise<ListDocumentsResponse | undefined> {
    this.loading = true;
    const result = (await req!.send()) as ListDocumentsResponse | undefined;
    this.loading = false;

    if (result) {
      this.items = result.items;
      this.total = result.total;
    }
    return result;
  }

  @api('/api/documents/:id')
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

  @api('/api/documents/:id', {
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
