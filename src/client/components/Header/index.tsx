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
  Col,
  Divider,
  Dropdown,
  Row,
  Select,
  Switch,
  Typography,
} from 'antd';
import type { ItemType } from 'antd/es/menu/interface';
import { observer } from 'mobx-react-lite';
import { useNavigate } from 'react-router-dom';
import './index.scss';

const Header = () => {
  const userStore = useStore('user');
  const authStore = useStore('auth');
  const settingStore = useStore('setting');
  const currentUser = userStore.currentUser;
  const navigate = useNavigate();

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
      <Row wrap={false} align="middle" className="header">
        <Col className="logo">
          <Typography.Title level={3}>Langvis</Typography.Title>
        </Col>
        <Divider orientation="vertical" />

        <Col flex={1} />
        <Divider orientation="vertical" />

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
      </Row>
      <div className="header-placeholder" />
    </>
  );
};

export default observer(Header);
