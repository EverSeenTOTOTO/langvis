import { api, ApiRequest } from '@/client/decorator/api';
import { store } from '@/client/decorator/store';
import type {
  EmailDetail,
  ListEmailsRequest,
  ListEmailsResponse,
} from '@/shared/dto/controller/email.dto';
import { makeAutoObservable } from 'mobx';

@store()
export class EmailStore {
  currentEmail: EmailDetail | null = null;

  constructor() {
    makeAutoObservable(this);
  }

  @api('/api/emails')
  async listEmails(
    _params?: ListEmailsRequest,
    req?: ApiRequest<ListEmailsRequest>,
  ): Promise<ListEmailsResponse | undefined> {
    const result = await req!.send();
    return result as ListEmailsResponse | undefined;
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
}
