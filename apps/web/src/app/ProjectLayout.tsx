import { CheckSquareOutlined, GlobalOutlined, InfoCircleOutlined, ProjectOutlined, UnorderedListOutlined } from '@ant-design/icons';
import { Breadcrumb, Tabs } from 'antd';
import { ComponentType, lazy, Suspense } from 'react';
import { Link, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getProject } from '../api/generated/api';
import { ErrorState } from '../components/EmptyState';
import BacklogPage from '../features/backlog/BacklogPage';
import BoardPage from '../features/board/BoardPage';
import SummaryPage from '../features/summary/SummaryPage';
import ProjectInfoPage from '../features/projects/ProjectInfoPage';
// AG Grid khá nặng nên chỉ tải khi mở tab Test cases
const TestCasesPage = lazy(() => import('../features/test-cases/TestCasesPage'));

export interface ProjectTab {
  key: string;
  label: string;
  icon: ComponentType;
  path: string;
  element: ComponentType;
}

/** Thêm tab mới (Timeline, List...) chỉ cần thêm một phần tử vào mảng này (mục 9). */
export const projectTabs: ProjectTab[] = [
  { key: 'info', label: 'Thông tin dự án', icon: InfoCircleOutlined, path: 'info', element: ProjectInfoPage },
  { key: 'summary', label: 'Summary', icon: GlobalOutlined, path: 'summary', element: SummaryPage },
  { key: 'backlog', label: 'Backlog', icon: UnorderedListOutlined, path: 'backlog', element: BacklogPage },
  { key: 'board', label: 'Active sprint', icon: ProjectOutlined, path: 'board', element: BoardPage },
  { key: 'test-cases', label: 'Test cases', icon: CheckSquareOutlined, path: 'test-cases', element: TestCasesPage },
];

export function ProjectLayout() {
  const { projectKey } = useParams();
  const nav = useNavigate();
  const loc = useLocation();
  const { data: project, error, refetch } = useQuery({ queryKey: ['project', projectKey], queryFn: () => getProject(projectKey!), enabled: !!projectKey });
  const active = projectTabs.find((t) => loc.pathname.includes(`/${t.path}`))?.key ?? 'summary';
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  return (
    <div>
      <div style={{ background: '#fff', padding: '12px 24px 0', borderBottom: '1px solid #f0f0f0' }}>
        <Breadcrumb items={[{ title: <Link to="/projects">Dự án</Link> }, { title: project ? `${project.key} — ${project.name}` : projectKey }]} />
        <Tabs activeKey={active} onChange={(k) => nav({ pathname: `/projects/${projectKey}/${k}`, search: k === active ? loc.search : '' })}
          items={projectTabs.map((t) => ({ key: t.path, label: <span><t.icon /> {t.label}</span> }))} />
      </div>
      <Suspense fallback={<div className="page muted">Đang tải…</div>}><Outlet /></Suspense>
    </div>
  );
}
