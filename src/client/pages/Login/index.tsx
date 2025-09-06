import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { Button, Card, Form, Input, message } from 'antd';
import { useStore } from '@/client/store';
import { useNavigate, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import './index.scss';
import { observer } from 'mobx-react-lite';
import { isClient } from '@/shared/constants';
import { useAsyncFn } from 'react-use';

const Login = () => {
  const authStore = useStore('auth');
  const userStore = useStore('user');
  const setting = useStore('setting');
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    // Only run redirect logic in browser environment
    if (isClient() && userStore.currentUser) {
      // If user is already logged in, redirect to home or the page they were trying to access
      const from = (location.state as any)?.from || '/';
      navigate(from);
    }
  }, [location.state]);

  const signInApi = useAsyncFn(authStore.signInAndSetUser.bind(authStore));

  const onFinish = async (values: { email: string; password: string }) => {
    try {
      const result = await signInApi[1]({
        email: values.email,
        password: values.password,
      });

      console.log(result)

      // Handle redirect from server in case of auth error
      if (result && typeof result === 'object' && 'redirect' in result) {
        navigate(result.redirect as string);
        return;
      }

      if (result.data?.user) {
        message.success('Login successful!');
        // Redirect to the page they were trying to access or home
        const from = (location.state as any)?.from || '/';
        navigate(from);
      } else {
        message.error('Login failed. Please check your credentials.');
      }
    } catch (error: any) {
      message.error('Login failed. Please check your credentials.');
      console.error('Login error:', error);
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

