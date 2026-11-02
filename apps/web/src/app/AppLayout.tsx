import {
  ApiOutlined, AppstoreOutlined, BarChartOutlined, DashboardOutlined, KeyOutlined, LogoutOutlined, MenuFoldOutlined, MenuUnfoldOutlined,
  PlusOutlined, SettingOutlined, TeamOutlined, UserOutlined,
} from '@ant-design/icons';
import { Button, Dropdown, Input, Layout, Menu, Space, Typography } from 'antd';
import { useEffect, useMemo } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AUTH_EXPIRED_EVENT } from '../api/http';
import { useAuth } from '../features/auth/authStore';
import { CreateIssueModal } from '../features/issues/CreateIssueModal';
import { useCreateIssueModal } from '../features/issues/createIssueStore';
import { IssueDrawerHost } from '../features/issues/IssueDrawerHost';
import { ChangePasswordModal } from '../features/auth/ChangePasswordModal';
import { useUi } from '../stores/ui';
import { useState } from 'react';

const { Sider, Header, Content } = Layout;

export function AppLayout() {
  const { user, projects, isSystemAdmin, logout } = useAuth();
  const { sidebarCollapsed, toggleSidebar } = useUi();
  const nav = useNavigate();
  const loc = useLocation();
  const show = useCreateIssueModal((s) => s.show);
  const [pwOpen, setPwOpen] = useState(false);

  useEffect(() => {
    const h = () => { useAuth.setState({ user: null, projects: [] }); nav('/login', { state: { from: loc.pathname + loc.search } }); };
    window.addEventListener(AUTH_EXPIRED_EVENT, h);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, h);
  }, [nav, loc.pathname, loc.search]);

  const isAnyProjectAdmin = isSystemAdmin() || projects.some((p) => p.role === 'admin');
  const isAdmin = isSystemAdmin();
  // 6 menu chính (mục 1); Member/API Keys/Cấu hình chỉ hiện với người có quyền
  const items = useMemo(
    () => [
      { key: '/dashboard', icon: <DashboardOutlined />, label: 'Dashboard' },
      { key: '/projects', icon: <AppstoreOutlined />, label: 'Dự án' },
      ...(isAdmin ? [{ key: '/members', icon: <TeamOutlined />, label: 'Member' }] : []),
      { key: '/reports', icon: <BarChartOutlined />, label: 'Report' },
      ...(isAnyProjectAdmin ? [{ key: '/api-keys', icon: <KeyOutlined />, label: 'API Keys' }, { key: '/settings', icon: <SettingOutlined />, label: 'Cấu hình' }] : []),
    ],
    [isAnyProjectAdmin, isAdmin],
  );
  const selected = items.find((i) => loc.pathname.startsWith(i.key) || (i.key === '/projects' && loc.pathname.startsWith('/browse')))?.key;

  return (
    <Layout style={{ minHeight: '100dvh' }}>
      <Sider collapsible collapsed={sidebarCollapsed} trigger={null} width={210} theme="light" style={{ borderRight: '1px solid #f0f0f0' }}>
        <div style={{ height: 56, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontWeight: 700, fontSize: 18, color: '#f51d53' }}>
          <ApiOutlined />{!sidebarCollapsed && 'OSP QA HUB'}
        </div>
        <Menu mode="inline" selectedKeys={selected ? [selected] : []} items={items} onClick={({ key }) => nav(key)} />
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', padding: '0 16px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid #f0f0f0' }}>
          <Button type="text" icon={sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={toggleSidebar} aria-label="Thu gọn menu" />
          <Input.Search placeholder="Tìm nhanh theo mã item (ELMS-2249)" allowClear style={{ maxWidth: 360 }}
            onSearch={(v) => { const k = v.trim().toUpperCase(); if (/^[A-Z][A-Z0-9]+-\d+$/.test(k)) nav(`/browse/${k}`); }} />
          <div style={{ flex: 1 }} />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => show()}>Tạo</Button>
          <Dropdown menu={{ items: [
            { key: 'pw', label: 'Đổi mật khẩu', onClick: () => setPwOpen(true) },
            { key: 'out', icon: <LogoutOutlined />, label: 'Đăng xuất', onClick: async () => { await logout(); nav('/login'); } },
          ] }}>
            <Space style={{ cursor: 'pointer' }}><UserOutlined /><Typography.Text>{user?.displayName}</Typography.Text></Space>
          </Dropdown>
        </Header>
        <Content style={{ overflow: 'auto' }}><Outlet /></Content>
      </Layout>
      <CreateIssueModal />
      <IssueDrawerHost />
      <ChangePasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
    </Layout>
  );
}
