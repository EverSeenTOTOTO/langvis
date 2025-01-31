import { message } from 'antd';
import { Locale } from 'antd/es/locale';
import enUS from 'antd/locale/en_US';
import zhCN from 'antd/locale/zh_CN';
import i18next from 'i18next';
import { useEffect, useState } from 'react';
import { useStore } from '../store';

export const SUPPORTED_LOCALES = {
  zh_CN: '简体中文',
  en_US: 'English',
};

export default () => {
  const setting = useStore('setting');

  useEffect(() => {
    i18next
      .init({
        lng: 'zh_CN',
        debug: true,
        resources: {
          en_US: {},
          zh_CN: {
            translation: {
              interaction: '交互',
              Language: '语言',
              'Node name': '节点名称',
              'Node Properties': '节点属性',
              'Search nodes': '搜索节点',
              Theme: '颜色主题',
            },
          },
        },
      })
      .catch(e => {
        message.error(e.message);
      });
  }, []);

  const [locale, setLocale] = useState<Locale | undefined>(undefined);

  useEffect(() => {
    switch (setting.lang) {
      case 'en_US':
        i18next.changeLanguage('en_US').then(() => {
          import('dayjs/locale/en');
          setLocale(enUS);
          // trigger rerender
          setting.setTr(i18next.getFixedT('en_US'));
        });
        break;
      case 'zh_CN':
      default:
        i18next.changeLanguage('zh_CN').then(() => {
          import('dayjs/locale/zh-cn');
          setLocale(zhCN);
          setting.setTr(i18next.getFixedT('zh_CN'));
        });
        break;
    }
  }, [setting.lang]);

  return { locale };
};
