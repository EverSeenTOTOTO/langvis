import { useStore } from '@/client/store';
import { Switch, SwitchProps } from 'antd';
import { observer } from 'mobx-react-lite';

const ThemeToggle = (props: SwitchProps) => {
  const theme = useStore('theme');

  return (
    <Switch
      checked={theme.mode === 'dark'}
      onChange={() => theme.toggleMode()}
      {...props}
    />
  );
};

export default observer(ThemeToggle);
