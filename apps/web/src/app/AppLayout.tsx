import {
  ArrowLeftOutlined, ApiOutlined, AppstoreOutlined, BarChartOutlined, DashboardOutlined, KeyOutlined, LogoutOutlined, MenuFoldOutlined, MenuUnfoldOutlined,
  PlusOutlined, SettingOutlined, TeamOutlined, UserOutlined,
} from '@ant-design/icons';
import { Button, Dropdown, Input, Layout, Menu, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation, useMatches, useNavigate } from 'react-router-dom';
import { AUTH_EXPIRED_EVENT } from '../api/http';
import { useAuth } from '../features/auth/authStore';
import { CreateIssueModal } from '../features/issues/CreateIssueModal';
import { useCreateIssueModal } from '../features/issues/createIssueStore';
import { IssueDrawerHost } from '../features/issues/IssueDrawerHost';
import { ChangePasswordModal } from '../features/auth/ChangePasswordModal';
import { useUi } from '../stores/ui';
import { useQuickSearch } from '../features/issues/useQuickSearch';

const { Sider, Header, Content } = Layout;

export function AppLayout() {
  const { user, projects, isSystemAdmin, logout } = useAuth();
  const { sidebarCollapsed, toggleSidebar } = useUi();
  const nav = useNavigate();
  const loc = useLocation();
  const matches = useMatches();
  const screenTitle = matches.reduce((title, match) => (match.handle as { title?: string } | undefined)?.title ?? title, 'OSP QA HUB');
  const projectKey = loc.pathname.startsWith('/projects/') ? matches.find((match) => match.params.projectKey)?.params.projectKey : undefined;
  const show = useCreateIssueModal((s) => s.show);
  const [pwOpen, setPwOpen] = useState(false);
  const quickSearch = useQuickSearch();

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
    <Layout style={{ height: '100dvh', overflow: 'hidden' }}>
      <Sider collapsible collapsed={sidebarCollapsed} trigger={null} width={210} theme="light" style={{ height: '100%', overflow: 'hidden', borderRight: '1px solid #f0f0f0' }}>
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <div style={{ height: 56, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontWeight: 700, fontSize: 18, color: '#f51d53' }}>
            <ApiOutlined />{!sidebarCollapsed && 'OSP QA HUB'}
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            <Menu mode="inline" selectedKeys={selected ? [selected] : []} items={items} onClick={({ key }) => nav(key)} />
          </div>
          <div style={{ flexShrink: 0, padding: sidebarCollapsed ? 8 : 12, borderTop: '1px solid #f0f0f0' }}>
            <Dropdown trigger={['click']} placement="topLeft" menu={{ items: [
              { key: 'pw', label: 'Đổi mật khẩu', onClick: () => setPwOpen(true) },
              { key: 'out', icon: <LogoutOutlined />, label: 'Đăng xuất', onClick: async () => { await logout(); nav('/login'); } },
            ] }}>
              <Button type="text" block icon={<UserOutlined />} aria-label={`Tài khoản: ${user?.displayName ?? ''}`} title={user?.displayName}
                style={{ height: 40, display: 'flex', alignItems: 'center', justifyContent: sidebarCollapsed ? 'center' : 'flex-start' }}>
                {!sidebarCollapsed && <Typography.Text ellipsis style={{ minWidth: 0 }}>{user?.displayName}</Typography.Text>}
              </Button>
            </Dropdown>
          </div>
        </div>
      </Sider>
      <Layout style={{ minWidth: 0, minHeight: 0 }}>
        <Header style={{ flexShrink: 0, background: '#fff', padding: '0 16px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid #f0f0f0' }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
            <Button type="text" style={{ flexShrink: 0 }} icon={sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={toggleSidebar} aria-label="Thu gọn menu" />
            {projectKey && <Button aria-label="Danh sách dự án" icon={<ArrowLeftOutlined />} onClick={() => nav('/projects')} style={{ flexShrink: 0 }}>Danh sách dự án</Button>}
            <Typography.Text strong ellipsis data-testid="screen-title" style={{ minWidth: 0, fontSize: 18 }}>{projectKey ? `${projectKey} / ${screenTitle}` : screenTitle}</Typography.Text>
          </div>
          <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
            <Input.Search placeholder="Tìm nhanh theo mã item (ELMS-2249)" allowClear style={{ width: 'clamp(100px, 25vw, 360px)' }}
              value={quickSearch.value} onChange={(e) => quickSearch.onChange(e.target.value)} onSearch={quickSearch.onSearch} />
            <Button type="primary" icon={<PlusOutlined />} onClick={() => show()}>Tạo</Button>
          </div>
        </Header>
        <Content style={{ minHeight: 0, overflow: 'auto' }}><Outlet /></Content>
      </Layout>
      <CreateIssueModal />
      <IssueDrawerHost />
      <ChangePasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
    </Layout>
  );
}
