import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { parseIds } from '../common/bigint';
import { clampLimit, decodeCursor, toPage } from '../common/pagination';
import { PrismaService } from '../common/prisma.service';

export interface SummaryFilter {
  assigneeIds?: bigint[];
  types?: string[];
  source?: string;
  scope?: 'open' | 'all';
}

const filterSql = (f: SummaryFilter, alias = 'i'): Prisma.Sql => {
  const parts: Prisma.Sql[] = [];
  const col = (c: string) => Prisma.raw(`${alias}.${c}`);
  if (f.assigneeIds?.length) parts.push(Prisma.sql`AND ${col('assignee_id')} = ANY(${f.assigneeIds})`);
  if (f.types?.length) parts.push(Prisma.sql`AND ${col('type')} = ANY(${f.types})`);
  if (f.source) parts.push(Prisma.sql`AND ${col('source')} = ${f.source}`);
  return parts.length ? Prisma.join(parts, ' ') : Prisma.empty;
};

export function parseSummaryFilter(q: { assigneeIds?: string; type?: string; source?: string; scope?: 'open' | 'all' }): SummaryFilter {
  return { assigneeIds: parseIds(q.assigneeIds), types: q.type ? q.type.split(',').filter(Boolean) : undefined, source: q.source, scope: q.scope ?? 'open' };
}

@Injectable()
export class SummaryService {
  constructor(private readonly prisma: PrismaService) {}

  /** Bốn thẻ số liệu 7 ngày (định nghĩa ở mục 7). Dùng chung cho Summary và Dashboard. */
  async cards(projectIds: bigint[], f: SummaryFilter = {}) {
    const flt = filterSql(f);
    const [completed, updated, created, due] = await Promise.all([
      this.prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(DISTINCT sc.issue_id) n FROM issue_status_changes sc
        JOIN issues i ON i.id = sc.issue_id JOIN workflow_statuses s ON s.id = sc.to_status_id
        WHERE i.project_id = ANY(${projectIds}) AND i.deleted_at IS NULL AND s.category = 'done'
          AND sc.changed_at >= now() - interval '7 days' ${flt}`,
      this.prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) n FROM issues i WHERE i.project_id = ANY(${projectIds}) AND i.deleted_at IS NULL
          AND i.updated_at >= now() - interval '7 days' ${flt}`,
      this.prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) n FROM issues i WHERE i.project_id = ANY(${projectIds}) AND i.deleted_at IS NULL
          AND i.created_at >= now() - interval '7 days' ${flt}`,
      this.prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) n FROM issues i JOIN workflow_statuses s ON s.id = i.status_id
        WHERE i.project_id = ANY(${projectIds}) AND i.deleted_at IS NULL AND s.category <> 'done'
          AND i.due_date BETWEEN current_date AND current_date + 7 ${flt}`,
    ]);
    return { completedLast7d: Number(completed[0].n), updatedLast7d: Number(updated[0].n), createdLast7d: Number(created[0].n), dueNext7d: Number(due[0].n) };
  }

  async summary(projectId: bigint, f: SummaryFilter) {
    const flt = filterSql(f);
    const [cards, statuses, source, byType, byPriority, activity, bugReport] = await Promise.all([
      this.cards([projectId], f),
      this.prisma.$queryRaw<{ id: bigint; name: string; category: string; color: string; position: number; n: bigint }[]>`
        SELECT s.id, s.name, s.category, s.color, s.position, count(i.id) n
        FROM workflow_statuses s LEFT JOIN issues i ON i.status_id = s.id AND i.deleted_at IS NULL ${flt}
        WHERE s.project_id = ${projectId} AND (NOT s.is_archived OR i.id IS NOT NULL)
        GROUP BY s.id ORDER BY s.position`,
      this.prisma.$queryRaw<{ source: string; pending: boolean; n: bigint }[]>`
        SELECT i.source, (s.category = 'triage') pending, count(*) n FROM issues i JOIN workflow_statuses s ON s.id = i.status_id
        WHERE i.project_id = ${projectId} AND i.deleted_at IS NULL ${flt} GROUP BY 1, 2`,
      this.prisma.$queryRaw<{ type: string; n: bigint }[]>`
        SELECT i.type, count(*) n FROM issues i WHERE i.project_id = ${projectId} AND i.deleted_at IS NULL ${flt} GROUP BY 1 ORDER BY 2 DESC`,
      this.prisma.$queryRaw<{ priority: string; n: bigint }[]>`
        SELECT i.priority, count(*) n FROM issues i WHERE i.project_id = ${projectId} AND i.deleted_at IS NULL ${flt} GROUP BY 1
        ORDER BY array_position(ARRAY['highest','high','medium','low','lowest'], i.priority)`,
      this.recentActivity([projectId], undefined, 20),
      this.bugReport(projectId, f),
    ]);
    const bySource = { manual: 0, auto: 0, pendingReview: 0 };
    for (const row of source) {
      bySource[row.source as 'manual' | 'auto'] += Number(row.n);
      if (row.pending) bySource.pendingReview += Number(row.n);
    }
    return {
      cards,
      statusOverview: { total: statuses.reduce((sum, row) => sum + Number(row.n), 0), items: statuses.map((row) => ({ statusId: row.id, name: row.name, category: row.category, color: row.color, count: Number(row.n) })) },
      bySource,
      byType: byType.map((row) => ({ type: row.type, count: Number(row.n) })),
      byPriority: byPriority.map((row) => ({ priority: row.priority, count: Number(row.n) })),
      bugReport,
      recentActivity: activity.items,
      recentActivityNextCursor: activity.nextCursor,
    };
  }

  private async bugReport(projectId: bigint, f: SummaryFilter) {
    const flt = filterSql({ ...f, types: undefined });
    const scope = f.scope ?? 'open';
    const createdLast7dFrom = new Date(Date.now() - 7 * 86400_000);
    const scopeSql = scope === 'open' ? Prisma.sql`AND s.category <> 'done'` : Prisma.empty;
    const [cardRows, statuses, source, byModule, byEpic, byPeriod, byFunction, byPriority] = await Promise.all([
      this.prisma.$queryRaw<{ total: bigint; highest: bigint; unassigned: bigint; created: bigint }[]>`
        SELECT count(*) total,
          count(*) FILTER (WHERE i.priority = 'highest') highest,
          count(*) FILTER (WHERE i.assignee_id IS NULL) unassigned,
          count(*) FILTER (WHERE i.created_at >= ${createdLast7dFrom}) created
        FROM issues i JOIN workflow_statuses s ON s.id = i.status_id
        WHERE i.project_id = ${projectId} AND i.deleted_at IS NULL AND i.type = 'bug' ${scopeSql} ${flt}`,
      this.prisma.$queryRaw<{ id: bigint; name: string; category: string; color: string; position: number; n: bigint }[]>`
        SELECT s.id, s.name, s.category, s.color, s.position, count(i.id) n
        FROM workflow_statuses s LEFT JOIN issues i ON i.status_id = s.id AND i.deleted_at IS NULL AND i.type = 'bug' ${flt}
        WHERE s.project_id = ${projectId} AND (NOT s.is_archived OR i.id IS NOT NULL)
          ${scope === 'open' ? Prisma.sql`AND s.category <> 'done'` : Prisma.empty}
        GROUP BY s.id ORDER BY s.position`,
      this.prisma.$queryRaw<{ source: string; pending: boolean; n: bigint }[]>`
        SELECT i.source, (s.category = 'triage') pending, count(*) n FROM issues i JOIN workflow_statuses s ON s.id = i.status_id
        WHERE i.project_id = ${projectId} AND i.deleted_at IS NULL AND i.type = 'bug' ${scopeSql} ${flt} GROUP BY 1, 2`,
      this.prisma.$queryRaw<{ id: bigint | null; label: string | null; n: bigint }[]>`
        WITH links AS (
          SELECT issue_id, module_id FROM issue_modules
          UNION
          SELECT f.issue_id, r.module_id FROM issue_functions f JOIN requirements r ON r.id = f.function_id WHERE r.module_id IS NOT NULL
        )
        SELECT m.id, CASE WHEN m.id IS NULL THEN NULL ELSE m.code || ' · ' || m.name END label, count(DISTINCT i.id) n
        FROM issues i JOIN workflow_statuses s ON s.id = i.status_id
        LEFT JOIN links l ON l.issue_id = i.id LEFT JOIN project_modules m ON m.id = l.module_id
        WHERE i.project_id = ${projectId} AND i.deleted_at IS NULL AND i.type = 'bug' ${scopeSql} ${flt}
        GROUP BY m.id, m.code, m.name ORDER BY n DESC, label`,
      this.prisma.$queryRaw<{ id: bigint | null; label: string | null; n: bigint }[]>`
        SELECT e.id, CASE WHEN e.id IS NULL THEN NULL ELSE p.key || '-' || e.number || ' · ' || e.title END label, count(DISTINCT i.id) n
        FROM issues i JOIN projects p ON p.id = i.project_id JOIN workflow_statuses s ON s.id = i.status_id
        LEFT JOIN issues e ON e.id = i.parent_id AND e.type = 'epic' AND e.deleted_at IS NULL
        WHERE i.project_id = ${projectId} AND i.deleted_at IS NULL AND i.type = 'bug' ${scopeSql} ${flt}
        GROUP BY e.id, p.key, e.number, e.title ORDER BY n DESC, label`,
      this.prisma.$queryRaw<{ id: bigint | null; label: string | null; n: bigint }[]>`
        SELECT sp.id, sp.name label, count(DISTINCT i.id) n
        FROM issues i JOIN workflow_statuses s ON s.id = i.status_id LEFT JOIN sprints sp ON sp.id = i.sprint_id
        WHERE i.project_id = ${projectId} AND i.deleted_at IS NULL AND i.type = 'bug' ${scopeSql} ${flt}
        GROUP BY sp.id, sp.name ORDER BY n DESC, label`,
      this.prisma.$queryRaw<{ id: bigint | null; label: string | null; n: bigint }[]>`
        SELECT r.id, CASE WHEN r.id IS NULL THEN NULL ELSE r.code || ' · ' || r.name END label, count(DISTINCT i.id) n
        FROM issues i JOIN workflow_statuses s ON s.id = i.status_id
        LEFT JOIN issue_functions f ON f.issue_id = i.id LEFT JOIN requirements r ON r.id = f.function_id
        WHERE i.project_id = ${projectId} AND i.deleted_at IS NULL AND i.type = 'bug' ${scopeSql} ${flt}
        GROUP BY r.id, r.code, r.name ORDER BY n DESC, label`,
      this.prisma.$queryRaw<{ priority: string; n: bigint }[]>`
        SELECT i.priority, count(*) n FROM issues i JOIN workflow_statuses s ON s.id = i.status_id
        WHERE i.project_id = ${projectId} AND i.deleted_at IS NULL AND i.type = 'bug' ${scopeSql} ${flt} GROUP BY 1
        ORDER BY array_position(ARRAY['highest','high','medium','low','lowest'], i.priority)`,
    ]);
    const total = statuses.reduce((a, s) => a + Number(s.n), 0);
    const bySource = { manual: 0, auto: 0, pendingReview: 0 };
    for (const r of source) {
      bySource[r.source as 'manual' | 'auto'] += Number(r.n);
      if (r.pending) bySource.pendingReview += Number(r.n);
    }
    const cards = { total: Number(cardRows[0].total), highest: Number(cardRows[0].highest), unassigned: Number(cardRows[0].unassigned), createdLast7d: Number(cardRows[0].created) };
    const dimension = (rows: { id: bigint | null; label: string | null; n: bigint }[], emptyLabel: string) => rows.map((row) => ({ id: row.id, label: row.label ?? emptyLabel, count: Number(row.n) }));
    return {
      scope,
      createdLast7dFrom: createdLast7dFrom.toISOString(),
      cards,
      statusOverview: {
        total,
        items: statuses.map((s) => ({ statusId: s.id, name: s.name, category: s.category, color: s.color, count: Number(s.n) })),
      },
      bySource,
      byModule: dimension(byModule, 'Chưa gắn Module'),
      byEpic: dimension(byEpic, 'Chưa gắn Epic'),
      byPeriod: dimension(byPeriod, 'Chưa phân bổ'),
      byFunction: dimension(byFunction, 'Chưa gắn Function'),
      byPriority: byPriority.map((r) => ({ priority: r.priority, count: Number(r.n) })),
    };
  }

  /** Hoạt động item gần đây của các dự án, kèm tiêu đề item. */
  async recentActivity(projectIds: bigint[], cursor?: string, limitIn?: number) {
    const limit = clampLimit(limitIn, 100, 20);
    const c = decodeCursor<{ id: string }>(cursor);
    const rows = await this.prisma.activityLog.findMany({
      where: { projectId: { in: projectIds }, entity: 'issue', ...(c ? { id: { lt: BigInt(c.id) } } : {}) },
      include: { actor: { select: { id: true, displayName: true, avatarUrl: true } }, apiKey: { select: { id: true, name: true } }, project: { select: { key: true } } },
      orderBy: { id: 'desc' }, take: limit + 1,
    });
    const page = toPage(rows, limit, (r) => ({ id: r.id.toString() }));
    const keys = [...new Set(page.items.map((r) => r.entityId))];
    const issues = keys.length
      ? await this.prisma.$queryRaw<{ key: string; title: string }[]>`
          SELECT p.key || '-' || i.number AS key, i.title FROM issues i JOIN projects p ON p.id = i.project_id
          WHERE (p.key || '-' || i.number) = ANY(${keys})`
      : [];
    const titleByKey = new Map(issues.map((i) => [i.key, i.title]));
    return {
      items: page.items.map((r) => ({
        id: r.id, actor: r.actor ?? (r.apiKey ? { id: null, displayName: `API key: ${r.apiKey.name}` } : null), action: r.action,
        projectKey: r.project?.key, issueKey: r.entityId, issueTitle: titleByKey.get(r.entityId) ?? null, changes: r.changes, createdAt: r.createdAt,
      })),
      nextCursor: page.nextCursor,
    };
  }
}
