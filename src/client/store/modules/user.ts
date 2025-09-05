import { api, ApiRequest } from '@/client/decorator/api';
import { User } from '@/shared/entities/User';
import { makeAutoObservable } from 'mobx';
import { singleton } from 'tsyringe';

@singleton()
export class UserStore {
  users: User[] = [];
  currentUser: User | null = null;

  constructor() {
    makeAutoObservable(this);
  }

  setCurrentUser(user: User | null) {
    this.currentUser = user;
  }

  @api('/api/users')
  async fetchAllUsers(_params?: any, req?: ApiRequest) {
    const users = await req!.send();
    this.users = users;
  }
}
