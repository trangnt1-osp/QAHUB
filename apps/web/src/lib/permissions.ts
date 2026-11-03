import { PROJECT_ROLE_RANK, ProjectRole, type Permission } from '@ospm/shared';

export const atLeast = (role: string | null | undefined, min: ProjectRole): boolean =>
  !!role && (PROJECT_ROLE_RANK as Record<string, number>)[role] >= PROJECT_ROLE_RANK[min];

export function projectHomePath(projectKey: string, hasPermission: (key: string, permission: Permission) => boolean) {
  const routes: [string, Permission][] = [['summary', 'project.summary.view'], ['backlog', 'project.backlog.view'], ['board', 'project.board.view'], ['test-cases', 'testcase.view'], ['structure', 'project.structure.view'], ['info', 'project.info.view']];
  const tab = routes.find(([, permission]) => hasPermission(projectKey, permission))?.[0];
  return `/projects/${projectKey}/${tab ?? 'info'}`;
}
