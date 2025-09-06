import {
  Avatar,
  Col,
  Divider,
  Dropdown,
  MenuProps,
  Row,
  Typography,
} from 'antd';
import {
  SettingOutlined,
  LogoutOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useStore } from '@/client/store';
import { observer } from 'mobx-react-lite';
import { useNavigate } from 'react-router-dom';

const Header = () => {
  const userStore = useStore('user');
  const authStore = useStore('auth');
  const settingStore = useStore('setting');
  const currentUser = userStore.currentUser;
  const navigate = useNavigate();

  const items: MenuProps['items'] = [
    {
      key: 'settings',
      icon: <SettingOutlined />,
      label: settingStore.tr('Settings'),
      onClick: () => {
        // Implementation for settings would go here
        // For now, we'll just show an alert as a placeholder
        alert('Settings functionality would be implemented here');
      },
    },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: settingStore.tr('Logout'),
      onClick: async () => {
        await authStore.signOutAndClearUser({});
        navigate('/login');
      },
    },
  ];

  return (
    <Row wrap={false} align="middle" className="header">
      <Col className="logo">
        <Typography.Title level={3}>Langvis</Typography.Title>
      </Col>
      <Divider type="vertical" />

      <Col flex={1} />
      <Divider type="vertical" />

      {currentUser ? (
        <Dropdown menu={{ items }} trigger={['click']}>
          <div className="user-dropdown">
            <Avatar src={currentUser.image} alt={currentUser.name} size="small">
              {!currentUser.image && <UserOutlined />}
            </Avatar>
            <span className="user-name">{currentUser.name}</span>
          </div>
        </Dropdown>
      ) : (
        <Avatar size="small" />
      )}
    </Row>
  );
};

export default observer(Header);
