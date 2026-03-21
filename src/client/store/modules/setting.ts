import { api, ApiRequest } from '@/client/decorator/api';
import { hydrate } from '@/client/decorator/hydrate';
import { store } from '@/client/decorator/store';
import { Locale } from 'antd/es/locale';
import enUS from 'antd/locale/en_US';
import zhCN from 'antd/locale/zh_CN';
import i18next from 'i18next';
import { makeAutoObservable, reaction } from 'mobx';

export type ThemeMode = 'light' | 'dark';

export const SUPPORTED_LOCALES = {
  zh_CN: '简体中文',
  en_US: 'English',
};

@store()
export class SettingStore {
  @hydrate()
  mode: ThemeMode = 'dark';

  @hydrate()
  lang: string = 'en_US';

  @hydrate()
  translations: Record<string, string> = {};

  locale: Locale = zhCN;
  tr: typeof i18next.t;

  constructor() {
    makeAutoObservable(this);

    this.initI18n();
    this.tr = i18next.getFixedT(this.lang);

    reaction(
      () => this.lang,
      () => {
        this.updateLocale(this.lang);
      },
    );
  }

  private initI18n() {
    if (!i18next.isInitialized) {
      i18next.init({
        lng: this.lang,
        fallbackLng: 'en_US',
        debug: false,
        resources: {
          en_US: { translation: this.translations },
          zh_CN: { translation: this.translations },
        },
      });
    } else {
      i18next.addResourceBundle(this.lang, 'translation', this.translations);
    }
  }

  private updateLocale(lang: string) {
    i18next.changeLanguage(lang).then(() => {
      i18next.addResourceBundle(lang, 'translation', this.translations);
      this.tr = i18next.getFixedT(lang);

      if (lang === 'en_US') {
        import('dayjs/locale/en');
        this.locale = enUS;
      } else {
        import('dayjs/locale/zh-cn');
        this.locale = zhCN;
      }
    });
  }

  toggleMode() {
    this.mode = this.mode === 'light' ? 'dark' : 'light';
    this.updateSettings({ themeMode: this.mode }).catch(() => {});
  }

  setLang(lang: string) {
    this.lang = lang;
    this.updateSettings({ locale: lang }).catch(console.warn);
  }

  @api('/api/settings', { method: 'get' })
  async fetchSettings(_params?: unknown, req?: ApiRequest<{}>): Promise<void> {
    const result = await req!.send();
    if (result) {
      this.mode = result.themeMode as ThemeMode;
      this.lang = result.locale;
      this.translations = result.translations;
      this.updateLocale(this.lang);
    }
  }

  @api('/api/settings', { method: 'put' })
  async updateSettings(
    _params: { themeMode?: ThemeMode; locale?: string },
    req?: ApiRequest<{ themeMode?: ThemeMode; locale?: string }>,
  ): Promise<void> {
    const result = await req!.send();
    if (result) {
      this.mode = result.themeMode as ThemeMode;
      this.lang = result.locale;
      this.translations = result.translations;
    }
  }
}
