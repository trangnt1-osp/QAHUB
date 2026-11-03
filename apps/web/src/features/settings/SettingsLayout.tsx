import { Select, Space, Tabs } from 'antd';
import { Navigate, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { Permission } from '@ospm/shared';
import { useAuth } from '../auth/authStore';
import { NoPermission } from '../auth/PermissionGate';

const tabs: { key: string; label: string; permission: Permission }[] = [
  { key: 'workflow', label: 'Workflow', permission: 'settings.workflow.view' },
  { key: 'general', label: 'Chung', permission: 'settings.general.view' },
  { key: 'labels', label: 'Label', permission: 'settings.labels.view' },
];

export function SettingsRedirect() {
  const { projectKey } = useParams();
  const { projects, hasPermission } = useAuth();
  const project = projects.find((candidate) => (!projectKey || candidate.projectKey === projectKey) && tabs.some((tab) => hasPermission(candidate.projectKey, tab.permission)));
  const tab = project && tabs.find((candidate) => hasPermission(project.projectKey, candidate.permission));
  return project && tab ? <Navigate to={`/settings/projects/${project.projectKey}/${tab.key}`} replace /> : <NoPermission />;
}

export function SettingsLayout() {
  const { projectKey = '' } = useParams();
  const { projects: allProjects, hasPermission } = useAuth();
  const projects = allProjects.filter((project) => tabs.some((tab) => hasPermission(project.projectKey, tab.permission)));
  const nav = useNavigate();
  const loc = useLocation();
  const tab = loc.pathname.split('/').pop() ?? 'workflow';
  return <div className="page">
    <Space style={{ marginBottom: 8 }}>
      <Select style={{ width: 260 }} value={projectKey} onChange={(key) => {
        const nextTab = tabs.find((candidate) => candidate.key === tab && hasPermission(key, candidate.permission)) ?? tabs.find((candidate) => hasPermission(key, candidate.permission));
        if (nextTab) nav(`/settings/projects/${key}/${nextTab.key}`);
      }} options={projects.map((project) => ({ value: project.projectKey, label: `${project.projectKey} — ${project.projectName}` }))} />
    </Space>
    <Tabs activeKey={tab} onChange={(key) => nav(`/settings/projects/${projectKey}/${key}`)} items={tabs.filter((candidate) => hasPermission(projectKey, candidate.permission)).map(({ key, label }) => ({ key, label }))} />
    <Outlet />
  </div>;
}
