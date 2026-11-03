import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { decodeCursor, clampLimit, toPage } from '../common/pagination';
import { PrismaService } from '../common/prisma.service';
import { ProjectContext } from '../common/decorators';
import { issueInclude, toIssueDto } from '../issues/issue-core';
import { ListIssuesQuery } from '../issues/issues.dto';
import { IssuesService } from '../issues/issues.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { BoardQuery } from './boards.dto';

type Dto = ReturnType<typeof toIssueDto>;

@Injectable()
export class BoardsService {
  constructor(private readonly prisma: PrismaService, private readonly issues: IssuesService, private readonly workflows: WorkflowsService) {}

  private estimateTotals(rows: { estimateMinutes: number | null; status: { category: string } }[]) {
    const t = { todo: 0, in_progress: 0, done: 0 };
    for (const r of rows) {
      const m = r.estimateMinutes ?? 0;
      if (r.status.category === 'done') t.done += m;
      else if (r.status.category === 'in_progress') t.in_progress += m;
      else t.todo += m;
    }
    return t;
  }

  async backlog(project: ProjectContext, q: ListIssuesQuery) {
    const config = await this.prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    const filters = this.issues.filterWhere(project.id, { ...q, cursor: undefined });
    const sprints = await this.prisma.sprint.findMany({
      where: { projectId: project.id, kind: config.trackingMode, deletedAt: null, state: { in: ['active', 'future'] } },
      orderBy: [{ state: 'asc' }, { position: 'asc' }, { id: 'asc' }], // 'active' < 'future'
    });
    const result = [];
    for (const sprint of sprints) {
      const inSprint: Prisma.IssueWhereInput = { sprintId: sprint.id, status: { category: { not: 'triage' } } };
      const [visible, all] = await Promise.all([
        this.prisma.issue.findMany({ where: { AND: [...filters, inSprint] }, include: issueInclude, orderBy: [{ rank: 'asc' }, { id: 'asc' }] }),
        this.prisma.issue.findMany({ where: { projectId: sprint.projectId, deletedAt: null, ...inSprint }, select: { estimateMinutes: true, status: { select: { category: true } } } }),
      ]);
      result.push({
        sprint,
        issues: visible.map((r) => toIssueDto(r, project.key)),
        totals: { total: all.length, visible: visible.length, estimate: this.estimateTotals(all) },
      });
    }
    const limit = clampLimit(q.limit);
    const cursor = decodeCursor<{ rank: string; id: string }>(q.cursor);
    const where: Prisma.IssueWhereInput[] = [...filters, { sprintId: null }];
    if (cursor) where.push({ OR: [{ rank: { gt: cursor.rank } }, { rank: cursor.rank, id: { gt: BigInt(cursor.id) } }] });
    const [rows, totalBacklog] = await Promise.all([
      this.prisma.issue.findMany({ where: { AND: where }, include: issueInclude, orderBy: [{ rank: 'asc' }, { id: 'asc' }], take: limit + 1 }),
      this.prisma.issue.count({ where: { AND: [...filters, { sprintId: null }] } }),
    ]);
    const page = toPage(rows, limit, (r) => ({ rank: r.rank, id: r.id.toString() }));
    return {
      sprints: result,
      backlog: { issues: page.items.map((r) => toIssueDto(r, project.key)), nextCursor: page.nextCursor, total: totalBacklog },
    };
  }

  async board(project: ProjectContext, q: BoardQuery) {
    const config = await this.prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    const activePeriods = await this.prisma.sprint.findMany({ where: { projectId: project.id, kind: config.trackingMode, state: 'active', deletedAt: null }, orderBy: [{ position: 'asc' }, { id: 'asc' }] });
    const sprint = activePeriods.find((period) => period.id.toString() === q.sprintId) ?? activePeriods[0];
    const columns = await this.workflows.boardColumns(project.id);
    const statusCols = columns.map((c) => ({ id: c.id, name: c.name, category: c.category, color: c.color, position: c.position }));
    const transitionMap: Record<string, string[]> = {};
    for (const c of columns) {
      transitionMap[c.id.toString()] = (await this.workflows.availableTransitions(project.id, c.id)).map((t) => t.statusId.toString());
    }
    if (!sprint) return { sprint: null, activePeriods, columns: statusCols, lanes: [], transitionMap };

    const filters = this.issues.filterWhere(project.id, { ...q, sprintId: undefined, cursor: undefined });
    const rows = await this.prisma.issue.findMany({
      where: { AND: [...filters, { sprintId: sprint.id, statusId: { in: columns.map((c) => c.id) } }] },
      include: issueInclude, orderBy: [{ rank: 'asc' }, { id: 'asc' }],
    });
    const dtos = rows.map((r) => toIssueDto(r, project.key));
    const groupBy = q.groupBy ?? 'none';
    const laneOf = (i: Dto): { id: string; label: string } => {
      if (groupBy === 'assignee') return i.assignee ? { id: `u${i.assignee.id}`, label: i.assignee.displayName } : { id: 'unassigned', label: 'Unassigned' };
      if (groupBy === 'parent') return i.parent ? { id: `p${i.parent.id}`, label: `${i.parent.key} ${i.parent.title}` } : { id: 'none', label: 'No Sub-task' };
      return { id: 'all', label: 'All' };
    };
    const lanes = new Map<string, { id: string; label: string; count: number; cells: Record<string, Dto[]> }>();
    for (const i of dtos) {
      const l = laneOf(i);
      if (!lanes.has(l.id)) lanes.set(l.id, { ...l, count: 0, cells: Object.fromEntries(columns.map((c) => [c.id.toString(), []])) });
      const lane = lanes.get(l.id)!;
      lane.cells[i.statusId.toString()].push(i);
      lane.count++;
    }
    if (groupBy === 'none' && lanes.size === 0) lanes.set('all', { id: 'all', label: 'All', count: 0, cells: Object.fromEntries(columns.map((c) => [c.id.toString(), []])) });
    const columnCounts = Object.fromEntries(columns.map((c) => [c.id.toString(), dtos.filter((d) => d.statusId === c.id).length]));
    return {
      sprint, activePeriods, columns: statusCols.map((c) => ({ ...c, count: columnCounts[c.id.toString()] })),
      lanes: [...lanes.values()].sort((a, b) => (a.id === 'none' || a.id === 'unassigned' ? 1 : b.id === 'none' || b.id === 'unassigned' ? -1 : a.label.localeCompare(b.label))),
      transitionMap,
    };
  }
}
