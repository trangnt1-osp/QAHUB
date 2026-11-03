import { Select, Space, Tabs } from 'antd';
import { Navigate, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { EmptyState } from '../../components/EmptyState';
import { useAuth } from '../auth/authStore';

function useAdminProjects() {
  const isAdmin = useAuth((s) => s.isSystemAdmin());
  return useAuth((s) => s.projects).filter((p) => isAdmin || p.role === 'admin');
}

export function SettingsRedirect() {
  const projects = useAdminProjects();
  if (!projects.length) return <div className="page"><EmptyState title="Bạn không phải admin của dự án nào" /></div>;
  return <Navigate to={`/settings/projects/${projects[0].projectKey}/workflow`} replace />;
}

export function SettingsLayout() {
  const { projectKey = '' } = useParams();
  const projects = useAdminProjects();
  const nav = useNavigate();
  const loc = useLocation();
  const tab = loc.pathname.split('/').pop() ?? 'workflow';
  return (
    <div className="page">
      <Space style={{ marginBottom: 8 }}>
        <Select style={{ width: 260 }} value={projectKey} onChange={(k) => nav(`/settings/projects/${k}/${tab}`)} options={projects.map((p) => ({ value: p.projectKey, label: `${p.projectKey} — ${p.projectName}` }))} />
      </Space>
      <Tabs activeKey={tab} onChange={(k) => nav(`/settings/projects/${projectKey}/${k}`)} items={[{ key: 'workflow', label: 'Workflow' }, { key: 'general', label: 'Chung' }, { key: 'labels', label: 'Label' }]} />
      <Outlet />
    </div>
  );
}
