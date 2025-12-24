import { store } from '@/client/decorator/store';
import { User } from '@/shared/entities/User';
import { makeAutoObservable } from 'mobx';

@store()
export class UserStore {
  currentUser: User | null = null;

  constructor() {
    makeAutoObservable(this);
  }

  setCurrentUser(user: User | null) {
    this.currentUser = user;
  }
}
