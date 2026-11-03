import { Spin } from 'antd';
import { useEffect } from 'react';
import { createBrowserRouter, Navigate, useLocation, useParams } from 'react-router-dom';
import { PermissionGate } from '../features/auth/PermissionGate';
import { RolesPage } from '../features/roles/RolesPage';
import { projectHomePath } from '../lib/permissions';
import { ApiKeysPage } from '../features/api-keys/ApiKeysPage';
import LoginPage from '../features/auth/LoginPage';
import { landingPage, useAuth } from '../features/auth/authStore';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { IssuePage } from '../features/issues/IssuePage';
import { IssueSearchPage } from '../features/issues/IssueSearchPage';
import { MembersPage } from '../features/members/MembersPage';
import { ProjectsPage } from '../features/projects/ProjectsPage';
import { ReportsPage } from '../features/reports/ReportsPage';
import { RunDetailPage } from '../features/reports/RunDetailPage';
import { SettingsLayout, SettingsRedirect } from '../features/settings/SettingsLayout';
import { GeneralSettings } from '../features/settings/GeneralSettings';
import { LabelSettings } from '../features/settings/LabelSettings';
import { WorkflowSettings } from '../features/settings/WorkflowSettings';
import { AppLayout } from './AppLayout';
import { ProjectLayout, projectTabs } from './ProjectLayout';

/** Chặn truy cập khi chưa đăng nhập; khôi phục phiên bằng refresh token khi tải lại trang. */
function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, ready, init } = useAuth();
  const loc = useLocation();
  useEffect(() => { if (!ready) void init(); }, [ready, init]);
  if (!ready) return <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}><Spin size="large" /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  return children;
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: <RequireAuth><AppLayout /></RequireAuth>,
    children: [
      { index: true, element: <HomeRedirect /> },
      { path: 'dashboard', element: <PermissionGate permission="dashboard.view"><DashboardPage /></PermissionGate>, handle: { title: 'Dashboard' } },
      { path: 'projects', element: <PermissionGate permission="project.view"><ProjectsPage /></PermissionGate>, handle: { title: 'Dự án' } },
      {
        path: 'projects/:projectKey',
        handle: { title: 'Dự án' },
        element: <PermissionGate permission="project.view"><ProjectLayout /></PermissionGate>,
        children: [
          { index: true, element: <ProjectRedirect /> },
          ...projectTabs.map((t) => ({ path: t.path, element: <PermissionGate permission={t.permission}><t.element /></PermissionGate>, handle: { title: t.label } })),
        ],
      },
      { path: 'browse/:issueKey', element: <PermissionGate permission="issue.view"><IssuePage /></PermissionGate>, handle: { title: 'Chi tiết công việc' } },
      { path: 'search', element: <IssueSearchPage />, handle: { title: 'Kết quả tìm kiếm' } },
      { path: 'members', element: <PermissionGate systemAdmin><MembersPage /></PermissionGate>, handle: { title: 'Người dùng' } },
      { path: 'roles', element: <PermissionGate systemAdmin><RolesPage /></PermissionGate>, handle: { title: 'Quản lý vai trò' } },
      { path: 'reports', element: <PermissionGate permission="report.view"><ReportsPage /></PermissionGate>, handle: { title: 'Report' } },
      { path: 'reports/runs/:runId', element: <PermissionGate permission="report.view"><RunDetailPage /></PermissionGate>, handle: { title: 'Chi tiết lần chạy' } },
      { path: 'api-keys', element: <PermissionGate permission="apikey.view"><ApiKeysPage /></PermissionGate>, handle: { title: 'API Keys' } },
      { path: 'settings', element: <PermissionGate permission="settings.view"><SettingsRedirect /></PermissionGate>, handle: { title: 'Cấu hình' } },
      {
        path: 'settings/projects/:projectKey',
        handle: { title: 'Cấu hình' },
        element: <PermissionGate permission="settings.view"><SettingsLayout /></PermissionGate>,
        children: [
          { index: true, element: <SettingsRedirect /> },
          { path: 'workflow', element: <PermissionGate permission="settings.workflow.view"><WorkflowSettings /></PermissionGate>, handle: { title: 'Cấu hình workflow' } },
          { path: 'general', element: <PermissionGate permission="settings.general.view"><GeneralSettings /></PermissionGate>, handle: { title: 'Cấu hình chung' } },
          { path: 'labels', element: <PermissionGate permission="settings.labels.view"><LabelSettings /></PermissionGate>, handle: { title: 'Cấu hình nhãn' } },
        ],
      },
    ],
  },
]);

function ProjectRedirect() {
  const { projectKey = '' } = useParams();
  const { hasPermission } = useAuth();
  return <Navigate to={projectHomePath(projectKey, hasPermission)} replace />;
}

function HomeRedirect() {
  useAuth();
  return <Navigate to={landingPage()} replace />;
}
