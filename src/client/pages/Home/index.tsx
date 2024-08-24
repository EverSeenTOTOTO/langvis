import { useStore } from '@/client/store';
import { MoonIcon, SunIcon } from '@radix-ui/react-icons';
import * as Menubar from '@radix-ui/react-menubar';
import { Button } from '@radix-ui/themes';
import { observer } from 'mobx-react-lite';
import './index.scss';

const MenubarDemo = () => {
  const theme = useStore('theme');

  return (
    <>
      <Menubar.Root className="MenubarRoot">
        <Button
          style={{ marginInlineStart: 'auto' }}
          variant="soft"
          onClick={() => theme.toggleMode()}
        >
          {theme.mode === 'dark' ? <SunIcon /> : <MoonIcon />}
        </Button>
      </Menubar.Root>
    </>
  );
};

export default observer(MenubarDemo);
