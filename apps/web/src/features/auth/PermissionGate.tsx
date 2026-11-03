import { Result } from 'antd';
import type { ReactNode } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import type { Permission } from '@ospm/shared';
import { useAuth } from './authStore';

export function NoPermission() {
  return <Result status="403" title="Không có quyền truy cập" subTitle="Vai trò của bạn trong dự án chưa được cấp quyền truy cập mục này." />;
}

/** Hide denied content before its data-fetching components can mount. */
export function PermissionGate({ permission, systemAdmin = false, children }: { permission?: Permission; systemAdmin?: boolean; children: ReactNode }) {
  const { projectKey, issueKey } = useParams();
  const [params] = useSearchParams();
  const { user, projects, hasPermission } = useAuth();
  const key = projectKey ?? (issueKey ? issueKey.slice(0, issueKey.lastIndexOf('-')) : params.get('project') ?? undefined);
  const allowed = systemAdmin ? user?.systemRole === 'admin' : !!permission && (key ? hasPermission(key, permission) : user?.systemRole === 'admin' || projects.some((project) => hasPermission(project.projectKey, permission)));
  return allowed ? <>{children}</> : <NoPermission />;
}
