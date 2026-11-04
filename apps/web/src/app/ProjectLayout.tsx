import { CheckSquareOutlined, GlobalOutlined, InfoCircleOutlined, ProjectOutlined, UnorderedListOutlined } from '@ant-design/icons';
import { Tabs } from 'antd';
import { ComponentType, lazy, Suspense } from 'react';
import { Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import type { Permission } from '@ospm/shared';
import { useAuth } from '../features/auth/authStore';
import { getProject } from '../api/generated/api';
import { EmptyState, ErrorState } from '../components/EmptyState';
import BacklogPage from '../features/backlog/BacklogPage';
import BoardPage from '../features/board/BoardPage';
import SummaryPage from '../features/summary/SummaryPage';
import ProjectInfoPage from '../features/projects/ProjectInfoPage';
// AG Grid khá nặng nên chỉ tải khi mở tab Test cases
const ProjectStructurePage = lazy(() => import('../features/project-structure/ProjectStructurePage'));
const TestCasesPage = lazy(() => import('../features/test-cases/TestCasesPage'));
const MasterplanPage = lazy(() => import('../features/masterplan/MasterplanPage'));

export interface ProjectTab {
  key: string;
  label: string;
  icon: ComponentType;
  path: string;
  element: ComponentType;
  permission: Permission;
}

/** Thêm tab mới (Timeline, List...) chỉ cần thêm một phần tử vào mảng này (mục 9). */
export const projectTabs: ProjectTab[] = [
  { key: 'info', label: 'Thông tin dự án', icon: InfoCircleOutlined, path: 'info', element: ProjectInfoPage, permission: 'project.info.view' },
  { key: 'masterplan', label: 'Masterplan', icon: ProjectOutlined, path: 'masterplan', element: MasterplanPage, permission: 'project.info.view' },
  { key: 'summary', label: 'Summary', icon: GlobalOutlined, path: 'summary', element: SummaryPage, permission: 'project.summary.view' },
  { key: 'backlog', label: 'Backlog', icon: UnorderedListOutlined, path: 'backlog', element: BacklogPage, permission: 'project.backlog.view' },
  { key: 'board', label: 'Active sprint', icon: ProjectOutlined, path: 'board', element: BoardPage, permission: 'project.board.view' },
  { key: 'structure', label: 'Epic / Module', icon: ProjectOutlined, path: 'structure', element: ProjectStructurePage, permission: 'project.structure.view' },
  { key: 'test-cases', label: 'Test cases', icon: CheckSquareOutlined, path: 'test-cases', element: TestCasesPage, permission: 'testcase.view' },
];

export function ProjectLayout() {
  const { projectKey } = useParams();
  const nav = useNavigate();
  const loc = useLocation();
  const { hasPermission } = useAuth();
  const { data: project, error, refetch } = useQuery({ queryKey: ['project', projectKey], queryFn: () => getProject(projectKey!), enabled: !!projectKey });
  const active = projectTabs.find((t) => loc.pathname.includes(`/${t.path}`))?.key ?? 'summary';
  if (error) {
    if (isAxiosError(error) && error.response?.status === 404 && new URLSearchParams(loc.search).has('q')) return <EmptyState title="Không có item phù hợp." />;
    return <ErrorState error={error} onRetry={refetch} />;
  }
  return (
    <div>
      <div style={{ background: '#fff', padding: '12px 24px 0', borderBottom: '1px solid #f0f0f0' }}>
        <Tabs activeKey={active} onChange={(k) => nav({ pathname: `/projects/${projectKey}/${k}`, search: k === active ? loc.search : '' })}
          items={projectTabs.filter((tab) => hasPermission(projectKey, tab.permission)).map((t) => ({ key: t.path, label: <span><t.icon /> {t.path === 'board' && project?.trackingMode === 'phase' ? 'Active phase' : t.label}</span> }))} />
      </div>
      <Suspense fallback={<div className="page muted">Đang tải…</div>}><Outlet /></Suspense>
    </div>
  );
}
