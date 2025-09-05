import { hydrate } from '@/client/decorator/hydrate';
import i18next from 'i18next';
import { makeAutoObservable } from 'mobx';
import { singleton } from 'tsyringe';

type ThemeMode = 'light' | 'dark';

@singleton()
export class SettingStore {
  @hydrate()
  mode: ThemeMode = 'dark';

  @hydrate()
  lang: string = 'zh_CN';

  tr = i18next.t;

  constructor() {
    makeAutoObservable(this);
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
