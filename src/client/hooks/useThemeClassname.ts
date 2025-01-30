import { useEffect } from 'react';
import { useStore } from '../store';

export default () => {
  const setting = useStore('setting');

  useEffect(() => {
    const root = document.body.querySelector('#root');

    if (!root) return;

    root.classList.forEach(className => {
      if (className.startsWith('root-')) {
        root.classList.remove(className);
      }
    });
    root.classList.add(`root-${setting.mode}`);
  }, [setting.mode]);
};
