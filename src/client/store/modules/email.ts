import { api, ApiRequest } from '@/client/decorator/api';
import { store } from '@/client/decorator/store';
import type {
  ArchiveEmailResponse,
  EmailDetail,
  ListEmailsRequest,
  ListEmailsResponse,
} from '@/shared/dto/controller/email.dto';
import { makeAutoObservable } from 'mobx';

@store()
export class EmailStore {
  items: ListEmailsResponse['items'] = [];
  total = 0;
  loading = false;

  currentEmail: EmailDetail | null = null;

  constructor() {
    makeAutoObservable(this);
  }

  @api('/api/emails')
  async list(
    _params?: ListEmailsRequest,
    req?: ApiRequest<ListEmailsRequest>,
  ): Promise<ListEmailsResponse | undefined> {
    this.loading = true;
    const result = (await req!.send()) as ListEmailsResponse | undefined;
    this.loading = false;

    if (result) {
      this.items = result.items;
      this.total = result.total;
    }
    return result;
  }

  @api('/api/emails/:id')
  async getEmailById(
    _params: { id: string },
    req?: ApiRequest<{ id: string }>,
  ): Promise<EmailDetail | undefined> {
    const result = await req!.send();
    if (result) {
      this.currentEmail = result as EmailDetail;
    }
    return result as EmailDetail | undefined;
  }

  @api('/api/emails/:id', {
    method: 'delete',
  })
  async deleteEmail(
    _params: { id: string },
    req?: ApiRequest<{ id: string }>,
  ): Promise<boolean> {
    const result = await req!.send();
    return result !== undefined;
  }

  @api('/api/emails/archive/:id', {
    method: 'post',
  })
  async archiveEmail(
    _params: { id: string },
    req?: ApiRequest<{ id: string }>,
  ): Promise<ArchiveEmailResponse | undefined> {
    const result = await req!.send();
    return result as ArchiveEmailResponse | undefined;
  }

  updateEmailStatus(id: string, status: 'unarchived' | 'archived'): void {
    const email = this.items.find(item => item.id === id);
    if (email) {
      email.status = status;
      if (status === 'archived') {
        (email as { archivedAt?: Date | null }).archivedAt = new Date();
      }
    }
  }
}
