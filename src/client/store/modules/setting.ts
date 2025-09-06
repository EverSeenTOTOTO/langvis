import { hydrate } from '@/client/decorator/hydrate';
import i18next from 'i18next';
import { autorun, makeAutoObservable } from 'mobx';
import { singleton } from 'tsyringe';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import { Locale } from 'antd/es/locale';

type ThemeMode = 'light' | 'dark';

export const SUPPORTED_LOCALES = {
  zh_CN: '简体中文',
  en_US: 'English',
};

// Initialize i18next with proper configuration
const initI18n = (lang: string = 'en_US') => {
  if (!i18next.isInitialized) {
    i18next.init({
      lng: lang,
      fallbackLng: 'en_US',
      debug: false,
      resources: {
        en_US: {},
        zh_CN: {
          translation: {
            Language: '语言',
            Theme: '颜色主题',
            Login: '登录',
            Logout: '退出登录',
            "Login failed": '登录失败',
            'Please input your email': '请输入邮箱',
            'Please input your password': '请输入密码',
          },
        },
      },
    });
  }
  return i18next.getFixedT(lang);
};

@singleton()
export class SettingStore {
  @hydrate()
  mode: ThemeMode = 'dark';

  @hydrate()
  lang: string = 'en_US';

  locale: Locale = zhCN;
  tr: typeof i18next.t;

  constructor() {
    makeAutoObservable(this);

    // Initialize i18n and set the translator function
    initI18n(this.lang);
    this.tr = i18next.getFixedT(this.lang);

    autorun(() => {
      switch (this.lang) {
        case 'en_US':
          i18next.changeLanguage('en_US').then(() => {
            import('dayjs/locale/en');
            this.setLocale(enUS);
            // trigger rerender
            this.setTr(i18next.getFixedT('en_US'));
          });
          break;
        case 'zh_CN':
        default:
          i18next.changeLanguage('zh_CN').then(() => {
            import('dayjs/locale/zh-cn');
            this.setLocale(zhCN);
            this.setTr(i18next.getFixedT('zh_CN'));
          });
          break;
      }
    });
  }

  toggleMode() {
    this.mode = this.mode === 'light' ? 'dark' : 'light';
  }

  setLang(i18n: string) {
    this.lang = i18n;
  }

  setLocale(locale: Locale) {
    this.locale = locale;
  }

  setTr(tr: typeof i18next.t) {
    this.tr = tr;
  }
}
