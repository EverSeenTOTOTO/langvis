import { api, ApiRequest } from '@/client/decorator/api';
import { store } from '@/client/decorator/store';
import type { UploadFileResponse } from '@/shared/dto/controller';
import { makeAutoObservable } from 'mobx';

export interface FileListItem {
  filename: string;
  size: number;
  mimeType: string;
  createdAt: Date;
  url: string;
}

@store()
export class FileStore {
  items: FileListItem[] = [];
  total = 0;
  page = 1;
  pageSize = 20;
  loading = false;

  constructor() {
    makeAutoObservable(this);
  }

  @api('/api/files/upload', { method: 'post' })
  async upload(
    _params: { file: File; agent?: string },
    req?: ApiRequest<{ file: File; agent?: string }>,
  ): Promise<UploadFileResponse> {
    return req!.send() as Promise<UploadFileResponse>;
  }

  @api('/api/files/list')
  async list(
    _params: { page?: number; pageSize?: number },
    req?: ApiRequest<{ page?: number; pageSize?: number }>,
  ): Promise<{
    items: FileListItem[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    this.loading = true;
    try {
      const result = (await req!.send()) as {
        items: FileListItem[];
        total: number;
        page: number;
        pageSize: number;
      };
      this.items = result.items;
      this.total = result.total;
      this.page = result.page;
      this.pageSize = result.pageSize;
      return result;
    } finally {
      this.loading = false;
    }
  }

  @api('/api/files/:filename', { method: 'delete' })
  async delete(
    _params: { filename: string },
    req?: ApiRequest<{ filename: string }>,
  ): Promise<void> {
    return req!.send();
  }
}
