import { Injectable } from '@nestjs/common';
import { BUILTIN_ROLE_PERMISSIONS, normalizePermissions, type ProjectRole } from '@ospm/shared';
import { AuthUser } from '../common/decorators';
import { PrismaService } from '../common/prisma.service';
import { SummaryService } from '../summary/summary.service';
import { builtinPermissionMap } from '../roles/builtin-roles';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService, private readonly summary: SummaryService) {}

  async get(user: AuthUser) {
    const isAdmin = user.systemRole === 'admin';
    const builtins = isAdmin ? BUILTIN_ROLE_PERMISSIONS : await builtinPermissionMap(this.prisma);
    const memberships = isAdmin
      ? (await this.prisma.project.findMany({ where: { deletedAt: null }, select: { id: true } })).map((p) => ({ projectId: p.id, permissions: BUILTIN_ROLE_PERMISSIONS.admin }))
      : (await this.prisma.projectMember.findMany({ where: { userId: user.id, leftAt: null, project: { deletedAt: null } }, include: { roleDefinition: true } }))
        .map((member) => ({ projectId: member.projectId, permissions: member.roleId ? normalizePermissions(member.roleDefinition?.permissions ?? []) : builtins[member.role as ProjectRole] ?? [] }));
    const visible = memberships.filter((member) => member.permissions.includes('dashboard.view'));
    const projectIds = visible.filter((member) => member.permissions.includes('issue.view')).map((member) => member.projectId);
    const triageIds = visible.filter((member) => member.permissions.includes('issue.triage')).map((member) => member.projectId);
    const reportIds = visible.filter((member) => member.permissions.includes('report.view')).map((member) => member.projectId);

    const [cards, pending, mine, runs, activity] = await Promise.all([
      this.summary.cards(projectIds),
      this.prisma.issue.findMany({
        where: { projectId: { in: triageIds }, deletedAt: null, status: { category: 'triage' } },
        include: { project: { select: { id: true, key: true, name: true } }, status: { select: { id: true, name: true, color: true } } },
        orderBy: [{ lastSeenAt: 'desc' }, { id: 'desc' }], take: 50,
      }),
      this.prisma.$queryRaw<any[]>`
        SELECT i.id, p.key || '-' || i.number AS key, i.title, i.type, i.priority, i.updated_at AS "updatedAt", i.source,
               p.id AS "projectId", p.key AS "projectKey", p.name AS "projectName",
               json_build_object('id', s.id, 'name', s.name, 'color', s.color, 'category', s.category) AS status
        FROM issues i JOIN projects p ON p.id = i.project_id JOIN workflow_statuses s ON s.id = i.status_id
        WHERE i.assignee_id = ${user.id} AND i.project_id = ANY(${projectIds}) AND i.deleted_at IS NULL AND s.category NOT IN ('done', 'triage') AND p.deleted_at IS NULL
        ORDER BY p.key, array_position(ARRAY['highest','high','medium','low','lowest'], i.priority), i.updated_at DESC`,
      this.prisma.automationRun.findMany({
        where: { projectId: { in: reportIds } }, orderBy: { id: 'desc' }, take: 5,
        include: { project: { select: { key: true, name: true } } },
      }),
      this.summary.recentActivity(projectIds, undefined, 20),
    ]);

    const byProject = new Map<string, { projectKey: string; projectName: string; issues: any[] }>();
    for (const r of mine) {
      if (!byProject.has(r.projectKey)) byProject.set(r.projectKey, { projectKey: r.projectKey, projectName: r.projectName, issues: [] });
      byProject.get(r.projectKey)!.issues.push({ id: r.id, key: r.key, title: r.title, type: r.type, priority: r.priority, source: r.source, status: r.status, updatedAt: r.updatedAt });
    }
    return {
      cards,
      pendingReview: pending.map((i) => ({
        id: i.id, key: `${i.project.key}-${i.number}`, title: i.title, project: i.project, status: i.status, occurrenceCount: i.occurrenceCount,
        firstSeenAt: i.firstSeenAt, lastSeenAt: i.lastSeenAt, priority: i.priority,
      })),
      canTriage: triageIds.length > 0,
      myWork: [...byProject.values()],
      recentRuns: runs.map((r) => ({
        id: r.id, projectKey: r.project.key, name: r.name, branch: r.branch, environment: r.environment, status: r.status,
        total: r.total, passed: r.passed, failed: r.failed, flaky: r.flaky, bugsCreated: r.bugsCreated,
        passRate: r.total > 0 ? Math.round((r.passed / r.total) * 1000) / 10 : null, createdAt: r.createdAt,
      })),
      recentActivity: activity.items,
      recentActivityNextCursor: activity.nextCursor,
    };
  }
}
