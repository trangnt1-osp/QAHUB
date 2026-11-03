import { Injectable } from '@nestjs/common';
import { BUILTIN_ROLE_PERMISSIONS, ERROR_CODES, normalizePermissions, Permission, PROJECT_ROLE_RANK, ProjectRole } from '@ospm/shared';
import { parseId } from './bigint';
import { forbidden, notFound } from './errors';
import { PrismaService } from './prisma.service';
import type { ProjectResolver } from './decorators';
import { builtinPermissions } from '../roles/builtin-roles';

export const ISSUE_KEY_REGEX = /^([A-Z][A-Z0-9]{1,9})-(\d+)$/;

export function parseIssueKey(issueKey: string): { projectKey: string; number: bigint } {
  const m = ISSUE_KEY_REGEX.exec(issueKey ?? '');
  if (!m) throw notFound(ERROR_CODES.ISSUE_NOT_FOUND, `Không tìm thấy item ${issueKey}`);
  return { projectKey: m[1], number: BigInt(m[2]) };
}

/** Xác định dự án mà một request đang thao tác, từ tham số URL. */
@Injectable()
export class ProjectContextService {
  constructor(private readonly prisma: PrismaService) {}

  async accessOf(user: { id: bigint; systemRole: string }, projectId: bigint) {
    if (user.systemRole === 'admin') return { role: 'admin' as ProjectRole, roleId: null, roleName: 'Admin', permissions: BUILTIN_ROLE_PERMISSIONS.admin };
    const member = await this.prisma.projectMember.findFirst({ where: { projectId, userId: user.id, leftAt: null }, include: { roleDefinition: true } });
    if (!member) return null;
    const role = member.role as ProjectRole;
    return { role, roleId: member.roleId, roleName: member.roleDefinition?.name ?? role,
      permissions: member.roleId ? normalizePermissions(member.roleDefinition?.permissions ?? []) : await builtinPermissions(this.prisma, role) };
  }

  async requirePermission(user: { id: bigint; systemRole: string }, projectId: bigint, permission: Permission) {
    if (!await this.prisma.project.count({ where: { id: projectId, deletedAt: null } })) throw forbidden('Dự án không còn khả dụng');
    const access = await this.accessOf(user, projectId);
    if (!access?.permissions.includes(permission)) throw forbidden('Bạn không có quyền thực hiện thao tác này trong dự án');
    return access;
  }

  async resolve(params: Record<string, string>, resolver: ProjectResolver): Promise<{ id: bigint; key: string }> {
    let projectId: bigint | null | undefined;
    const p = this.prisma;
    switch (resolver) {
      case 'project': {
        const key = params.projectKey ?? (params.issueKey ? parseIssueKey(params.issueKey).projectKey : undefined);
        if (!key) throw notFound(ERROR_CODES.PROJECT_NOT_FOUND, 'Không xác định được dự án');
        const project = await p.project.findFirst({ where: { key, deletedAt: null }, select: { id: true, key: true } });
        if (!project) throw notFound(ERROR_CODES.PROJECT_NOT_FOUND, `Không tìm thấy dự án ${key}`);
        return project;
      }
      case 'sprint':
        projectId = (await p.sprint.findFirst({ where: { id: parseId(params.id, ERROR_CODES.SPRINT_NOT_FOUND), deletedAt: null }, select: { projectId: true } }))?.projectId;
        if (projectId === undefined) throw notFound(ERROR_CODES.SPRINT_NOT_FOUND, 'Không tìm thấy sprint');
        break;
      case 'comment':
        projectId = (await p.issueComment.findFirst({ where: { id: parseId(params.id), deletedAt: null }, select: { issue: { select: { projectId: true } } } }))?.issue.projectId;
        if (projectId === undefined) throw notFound(ERROR_CODES.NOT_FOUND, 'Không tìm thấy comment');
        break;
      case 'apiKey':
        projectId = (await p.apiKey.findUnique({ where: { id: params.id }, select: { projectId: true } }).catch(() => null))?.projectId;
        if (projectId === undefined) throw notFound(ERROR_CODES.API_KEY_NOT_FOUND, 'Không tìm thấy API key');
        break;
      case 'run':
        projectId = (await p.automationRun.findUnique({ where: { id: parseId(params.id, ERROR_CODES.RUN_NOT_FOUND) }, select: { projectId: true } }))?.projectId;
        if (projectId === undefined) throw notFound(ERROR_CODES.RUN_NOT_FOUND, 'Không tìm thấy lần chạy');
        break;
      case 'result':
        projectId = (await p.automationResult.findUnique({ where: { id: parseId(params.id, ERROR_CODES.RESULT_NOT_FOUND) }, select: { run: { select: { projectId: true } } } }))?.run.projectId;
        if (projectId === undefined) throw notFound(ERROR_CODES.RESULT_NOT_FOUND, 'Không tìm thấy kết quả');
        break;
      case 'attachment':
        projectId = (await p.attachment.findUnique({ where: { id: params.id }, select: { projectId: true } }).catch(() => null))?.projectId;
        if (projectId === undefined) throw notFound(ERROR_CODES.ATTACHMENT_NOT_FOUND, 'Không tìm thấy file');
        break;
      case 'testCase':
        projectId = (await p.testCase.findFirst({ where: { id: parseId(params.id, ERROR_CODES.TEST_CASE_NOT_FOUND), deletedAt: null }, select: { projectId: true } }))?.projectId;
        if (projectId === undefined) throw notFound(ERROR_CODES.TEST_CASE_NOT_FOUND, 'Không tìm thấy test case');
        break;
      case 'requirement':
        projectId = (await p.requirement.findFirst({ where: { id: parseId(params.id, ERROR_CODES.REQUIREMENT_NOT_FOUND), deletedAt: null }, select: { projectId: true } }))?.projectId;
        if (projectId === undefined) throw notFound(ERROR_CODES.REQUIREMENT_NOT_FOUND, 'Không tìm thấy epic/function');
        break;
    }
    const project = await p.project.findFirst({ where: { id: projectId!, deletedAt: null }, select: { id: true, key: true } });
    if (!project) throw notFound(ERROR_CODES.PROJECT_NOT_FOUND, 'Không tìm thấy dự án');
    return project;
  }

  /** Vai trò hiệu lực của user trong dự án (system admin = admin); null nếu không phải thành viên. */
  async roleOf(user: { id: bigint; systemRole: string }, projectId: bigint): Promise<ProjectRole | null> {
    if (user.systemRole === 'admin') return 'admin';
    const m = await this.prisma.projectMember.findFirst({ where: { projectId, userId: user.id, leftAt: null }, select: { role: true } });
    return (m?.role as ProjectRole) ?? null;
  }

  async requireRole(user: { id: bigint; systemRole: string }, projectId: bigint, min: ProjectRole): Promise<ProjectRole> {
    const access = await this.accessOf(user, projectId);
    if (access?.roleId) throw forbidden('Cần kiểm tra quyền cụ thể cho vai trò tùy chỉnh');
    const role = await this.roleOf(user, projectId);
    if (!role) throw forbidden('Bạn không phải thành viên của dự án này');
    if (PROJECT_ROLE_RANK[role] < PROJECT_ROLE_RANK[min]) throw forbidden(`Cần vai trò ${min} trở lên trong dự án`);
    return role;
  }
}
