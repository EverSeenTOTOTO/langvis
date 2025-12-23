import { useStore } from '@/client/store';
import { SUPPORTED_LOCALES } from '@/client/store/modules/setting';
import {
  LogoutOutlined,
  MoonOutlined,
  SettingOutlined,
  SunOutlined,
  UserOutlined,
} from '@ant-design/icons';
import {
  Avatar,
  Dropdown,
  Flex,
  Select,
  Switch,
  theme,
  Typography,
} from 'antd';
import type { ItemType } from 'antd/es/menu/interface';
import { observer } from 'mobx-react-lite';
import { useNavigate } from 'react-router-dom';
import './index.scss';

const { useToken } = theme;

const Header = () => {
  const userStore = useStore('user');
  const authStore = useStore('auth');
  const settingStore = useStore('setting');
  const currentUser = userStore.currentUser;
  const navigate = useNavigate();
  const { token } = useToken();

  const items: ItemType[] = [
    {
      key: 'theme',
      type: 'submenu',
      icon: settingStore.mode === 'dark' ? <MoonOutlined /> : <SunOutlined />,
      label: settingStore.tr('Theme'),
      children: [
        {
          type: 'item',
          key: 'theme-switch',
          label: (
            <Switch
              onClick={(_, e) => e.stopPropagation()}
              unCheckedChildren={<SunOutlined />}
              checkedChildren={<MoonOutlined />}
              checked={settingStore.mode === 'dark'}
              onChange={() => settingStore.toggleMode()}
            />
          ),
        },
      ],
    },
    {
      key: 'language',
      type: 'submenu',
      icon: <SettingOutlined />,
      label: settingStore.tr('Language'),
      children: [
        {
          key: 'language-select',
          type: 'item',
          label: (
            <Select
              onClick={e => e.stopPropagation()}
              value={settingStore.lang}
              onChange={value => settingStore.setLang(value)}
              options={Object.keys(SUPPORTED_LOCALES).map(key => ({
                label: SUPPORTED_LOCALES[key as 'zh_CN'],
                value: key,
              }))}
              style={{ minWidth: 100 }}
            />
          ),
        },
      ],
    },
    {
      type: 'divider',
      key: 'divider',
    },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: settingStore.tr('Logout'),
      type: 'item',
      onClick: async () => {
        await authStore.signOut({});
        navigate('/login');
      },
    },
  ];

  return (
    <>
      <Flex
        wrap={false}
        align="middle"
        className="header"
        style={{
          backgroundColor: token.colorBgContainer,
          borderBottom: `1px solid ${token.colorBorder}`,
        }}
      >
        <Typography.Title
          className="logo"
          level={3}
          onClick={() => navigate('/')}
        >
          Langvis
        </Typography.Title>

        <span className="header-divider" />

        {currentUser ? (
          <Dropdown menu={{ items }} trigger={['click']}>
            <div className="user-dropdown">
              <Avatar
                src={currentUser.image}
                alt={currentUser.name}
                size="small"
              >
                {!currentUser.image && <UserOutlined />}
              </Avatar>
              <span className="user-name">{currentUser.name}</span>
            </div>
          </Dropdown>
        ) : (
          <Avatar size="small" />
        )}
      </Flex>
      <div className="header-placeholder" />
    </>
  );
};

export default observer(Header);
