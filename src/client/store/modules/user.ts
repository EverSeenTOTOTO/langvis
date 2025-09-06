import { User } from '@/shared/entities/User';
import { makeAutoObservable } from 'mobx';
import { singleton } from 'tsyringe';

@singleton()
export class UserStore {
  currentUser: User | null = null;

  constructor() {
    makeAutoObservable(this);
  }

  setCurrentUser(user: User | null) {
    this.currentUser = user;
  }
}
