import { hydrate } from '@/client/decorator/hydrate';
import { Locale } from 'antd/es/locale';
import enUS from 'antd/locale/en_US';
import zhCN from 'antd/locale/zh_CN';
import i18next from 'i18next';
import { makeAutoObservable, reaction } from 'mobx';
import { singleton } from 'tsyringe';

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
        en_US: {
          translation: {},
        },
        zh_CN: {
          translation: {
            Language: '语言',
            Theme: '颜色主题',
            Login: '登录',
            Logout: '退出登录',
            'Login failed': '登录失败',
            'Please input your email': '请输入邮箱',
            'Please input your password': '请输入密码',
            Conversation: '对话',
            'New Conversation': '新对话',
            'Failed to create or get conversation': '创建或获取对话失败',
            'Delete Conversation': '删除对话',
            'Are you sure you want to delete? This action cannot be undone.':
              '您确定要删除吗？此操作无法撤销。',
            Delete: '删除',
            Cancel: '取消',
            'Type a message...': '输入消息...',
            'Edit Conversation': '编辑对话',
            Save: '保存',
            'Conversation ID': '对话ID',
            'Conversation Name': '对话名称',
            'Please enter a conversation name': '请输入对话名称',
            'Enter conversation name': '输入对话名称',
            'Error parsing SSE message': '解析 SSE 消息时出错',
            'Failed to connect to SSE': '连接到 SSE 失败',
            'Received sse message for non-pending conversation':
              '收到了非进行中对话的 SSE 消息',
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

    initI18n(this.lang);
    this.tr = i18next.getFixedT(this.lang);

    reaction(
      () => this.lang,
      () => {
        switch (this.lang) {
          case 'en_US':
            i18next.changeLanguage('en_US').then(() => {
              import('dayjs/locale/en');
              this.setLocale(enUS);
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
      },
    );
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
