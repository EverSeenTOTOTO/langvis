import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { Button, Card, Form, Input, message } from 'antd';
import { useStore } from '@/client/store';
import { useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import './index.scss';

const Login = () => {
  const authStore = useStore('auth');
  const userStore = useStore('user');
  const navigate = useNavigate();

  useEffect(() => {
    // If user is already logged in, redirect to home
    if (userStore.currentUser) {
      navigate('/');
    }
  }, [userStore.currentUser, navigate]);

  const onFinish = async (values: { email: string; password: string }) => {
    try {
      const result = await authStore.signInAndSetUser({
        email: values.email,
        password: values.password,
      });

      if (result.data?.user) {
        message.success('Login successful!');
        navigate('/');
      } else {
        message.error('Login failed. Please check your credentials.');
      }
    } catch (error) {
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
            rules={[{ required: true, message: 'Please input your email!' }]}
          >
            <Input prefix={<UserOutlined />} placeholder="Email" />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[{ required: true, message: 'Please input your password!' }]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="Password" />
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" style={{ width: '100%' }}>
              Log in
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
};

export default Login;

