import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission, ProjectRole as ProjectRoleName, SystemRole as SystemRoleName } from '@ospm/shared';

export const IS_PUBLIC = 'isPublic';
export const IS_API_KEY = 'isApiKey';
export const PROJECT_ROLE = 'projectRole';
export const SYSTEM_ROLE = 'systemRole';
export const PROJECT_PERMISSION = 'projectPermission';

/** Endpoint không cần JWT (auth/login...) */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Endpoint chỉ nhận API key (nhóm /ingest/*) */
export const ApiKeyAuth = () => SetMetadata(IS_API_KEY, true);

export type ProjectResolver =
  | 'project' // :projectKey hoặc :issueKey (mặc định)
  | 'sprint'
  | 'comment'
  | 'apiKey'
  | 'run'
  | 'result'
  | 'attachment'
  | 'testCase'
  | 'requirement';

/** Yêu cầu vai trò tối thiểu trong dự án. System admin luôn qua. */
export const ProjectRole = (role: ProjectRoleName, resolver: ProjectResolver = 'project') =>
  SetMetadata(PROJECT_ROLE, { role, resolver });
export const SystemRole = (role: SystemRoleName) => SetMetadata(SYSTEM_ROLE, role);
/** One permission or any of a list; the project resolver remains on @ProjectRole. */
export const ProjectPermission = (permission: Permission | Permission[]) => SetMetadata(PROJECT_PERMISSION, Array.isArray(permission) ? permission : [permission]);

export interface AuthUser {
  id: bigint;
  email: string;
  displayName: string;
  systemRole: SystemRoleName;
}

export const CurrentUser = createParamDecorator((_d: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});

export interface ProjectContext {
  id: bigint;
  key: string;
  role: ProjectRoleName;
  roleId?: bigint | null;
  permissions?: Permission[];
}

/** Dự án đã được ProjectRolesGuard xác định cho request. */
export const CurrentProject = createParamDecorator((_d: unknown, ctx: ExecutionContext): ProjectContext => {
  return ctx.switchToHttp().getRequest().project;
});
