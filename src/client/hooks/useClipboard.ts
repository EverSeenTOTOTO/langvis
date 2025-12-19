import { message } from 'antd';
import { useStore } from '../store';
import { useCallback } from 'react';

export default () => {
  const settingStore = useStore('setting');

  const copyToClipboard = useCallback((content: string) => {
    navigator.clipboard.writeText(content);
    message.success(settingStore.tr('Copied'));
  }, []);

  return { copyToClipboard };
};
