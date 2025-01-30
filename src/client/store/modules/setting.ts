import { hydrate } from '@/client/decorator/hydrate';
import i18next from 'i18next';
import { makeAutoObservable } from 'mobx';
import type { AppStore } from '..';

type ThemeMode = 'light' | 'dark';

export class SettingStore {
  @hydrate()
  mode: ThemeMode = 'dark';

  @hydrate()
  lang: string = 'zh_CN';

  tr = i18next.t;

  root: AppStore;

  constructor(root: AppStore) {
    makeAutoObservable(this);
    this.root = root;
  }

  toggleMode() {
    this.mode = this.mode === 'light' ? 'dark' : 'light';
  }

  setLang(i18n: string) {
    this.lang = i18n;
  }

  setTr(tr: typeof i18next.t) {
    this.tr = tr;
  }
}
