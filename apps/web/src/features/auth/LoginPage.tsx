import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Form, Input, Typography } from 'antd';
import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { errorMessage } from '../../api/http';
import { landingPage, useAuth } from './authStore';
import loginPenguin from '../../assets/images/login-penguin.png';

export default function LoginPage() {
  const { user, login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  if (user) return <Navigate to={loc.state?.from ?? landingPage()} replace />;
  return (
    <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: '24px 16px', boxSizing: 'border-box', background: 'linear-gradient(135deg,#ffe4ec,#fff0f5)' }}>
      <div style={{ width: 'min(380px, 100%)' }}>
      {/* Minh họa nền trong suốt nằm trên form, giữ trong luồng để không bị cắt. */}
      <img src={loginPenguin} alt="" aria-hidden style={{ width: '72%', maxWidth: 270, height: 'auto', margin: '0 auto 8px', display: 'block', pointerEvents: 'none' }} />
      <Card style={{ width: '100%' }}>
        <Typography.Title level={3} style={{ textAlign: 'center', marginTop: 0 }}>OSP QA HUB</Typography.Title>
        <Typography.Paragraph type="secondary" style={{ textAlign: 'center' }}>Quản lý dự án & bug tự động</Typography.Paragraph>
        {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}
        <Form layout="vertical" onFinish={async (v) => {
          setLoading(true); setError(undefined);
          try { await login(v.email, v.password); nav(loc.state?.from ?? landingPage(), { replace: true }); }
          catch (e) { setError(errorMessage(e, 'Đăng nhập thất bại')); }
          finally { setLoading(false); }
        }}>
          <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email', message: 'Nhập email hợp lệ' }]}><Input size="large" prefix={<UserOutlined />} autoFocus style={{ borderRadius: 999 }} /></Form.Item>
          <Form.Item name="password" label="Mật khẩu" rules={[{ required: true, message: 'Nhập mật khẩu' }]}><Input.Password size="large" prefix={<LockOutlined />} style={{ borderRadius: 999 }} /></Form.Item>
          <Button type="primary" htmlType="submit" block size="large" loading={loading} style={{ borderRadius: 999 }}>Đăng nhập</Button>
        </Form>
      </Card>
      </div>
    </div>
  );
}
