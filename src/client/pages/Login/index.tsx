import { useStore } from '@/client/store';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { Button, Card, Form, Input, message } from 'antd';
import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAsyncFn } from 'react-use';
import './index.scss';

const Login = () => {
  const authStore = useStore('auth');
  const userStore = useStore('user');
  const setting = useStore('setting');
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    // Only run redirect logic in browser environment
    if (userStore.currentUser) {
      // If user is already logged in, redirect to home or the page they were trying to access
      const from = (location.state as any)?.from || '/';
      navigate(from);
    }
  }, [location.state]);

  const signInApi = useAsyncFn(authStore.signInAndSetUser.bind(authStore));

  const onFinish = async (values: { email: string; password: string }) => {
    try {
      // these api are not handled by @api decorator, so we need to catch errors here
      const result = await signInApi[1]({
        email: values.email,
        password: values.password,
      });

      // Handle redirect from server in case of auth error
      if (result && typeof result === 'object' && 'redirect' in result) {
        navigate(result.redirect as string);
        return;
      }

      if (result.data?.user) {
        // Redirect to the page they were trying to access or home
        const from = (location.state as any)?.from || '/';
        navigate(from);
      } else {
        message.error(
          `${setting.tr('Login failed')}: ${(result.error as any)?.error}`,
        );
      }
    } catch (error: any) {
      message.error(`${setting.tr('Login failed')}: ${error?.message}`);
    }
  };

  return (
    <div className="login-page">
      <Card title="Login" style={{ width: 300 }}>
        <Form name="login" onFinish={onFinish} autoComplete="off">
          <Form.Item
            name="email"
            rules={[
              {
                required: true,
                message: setting.tr('Please input your email'),
              },
            ]}
          >
            <Input prefix={<UserOutlined />} placeholder="Email" />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[
              {
                required: true,
                message: setting.tr('Please input your password'),
              },
            ]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="Password" />
          </Form.Item>

          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              style={{ width: '100%' }}
              loading={signInApi[0].loading}
            >
              {setting.tr('Login')}
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
};

export default observer(Login);

