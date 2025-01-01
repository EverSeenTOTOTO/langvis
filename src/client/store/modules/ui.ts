import { makeAutoObservable } from 'mobx';
import type { AppStore } from '..';
import { type MessageConfig } from '@/client/components/Message';

export type UiState = {};

export class UiStore {
  root: AppStore;

  notify: (message: MessageConfig) => Promise<void> = () => Promise.resolve();

  constructor(root: AppStore) {
    makeAutoObservable(this);
    this.root = root;
  }

  setNotify(notify: UiStore['notify']) {
    this.notify = notify;
  }
}
