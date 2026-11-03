import { guardEpicDeletion, syncIssueStructure } from './issue-structure';
import { Injectable } from '@nestjs/common';
import { ERROR_CODES, type Permission, ProjectRole as ProjectRoleName } from '@ospm/shared';
import { Prisma } from '@prisma/client';
import { ActivityService } from '../activity/activity.service';
import { parseId } from '../common/bigint';
import { AuthUser, ProjectContext } from '../common/decorators';
import { AppException, badRequest, conflict, forbidden, notFound, unprocessable } from '../common/errors';
import { clampLimit, decodeCursor, toPage } from '../common/pagination';
import { PrismaService, Tx } from '../common/prisma.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { BulkIssuesDto, CreateIssueDto, ListIssuesQuery, RankDto, TransitionDto, TriageDto, UpdateIssueDto } from './issues.dto';
import {
  allocateIssueNumber, doc, findIssueByKey, issueInclude, issueKeyOf, rankAtEnd, recordStatusChange, safeRankBetween, toIssueDto,
} from './issue-core';

type Actor = Pick<AuthUser, 'id'> & { systemRole?: string; permissions?: Permission[] };

@Injectable()
export class IssuesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly workflows: WorkflowsService,
  ) {}

  // ---------- Truy vấn ----------

  /** Điều kiện lọc dùng chung cho list, backlog và board. */
  filterWhere(projectId: bigint, q: Partial<ListIssuesQuery>): Prisma.IssueWhereInput[] {
    const and: Prisma.IssueWhereInput[] = [{ projectId, deletedAt: null }];
    if (q.q?.trim()) {
      const term = q.q.trim();
      const m = /^([A-Za-z][A-Za-z0-9]*)-(\d+)$/.exec(term);
      if (m) and.push({ number: BigInt(m[2]) });
      else if (/^\d+$/.test(term)) and.push({ OR: [{ number: BigInt(term) }, { title: { contains: term, mode: 'insensitive' } }] });
      else and.push({ title: { contains: term, mode: 'insensitive' } });
    }
    if (q.type?.length) and.push({ type: { in: q.type } });
    if (q.priority?.length) and.push({ priority: { in: q.priority } });
    if (q.statusIds?.length) and.push({ statusId: { in: q.statusIds.map((v) => parseId(v)) } });
    if (q.statusCategory) and.push({ status: { category: q.statusCategory === 'open' ? { not: 'done' } : 'done' } });
    if (q.createdFrom) and.push({ createdAt: { gte: new Date(`${q.createdFrom}T00:00:00.000Z`) } });
    if (q.assigneeIds?.length) {
      const ids = q.assigneeIds.filter((v) => v !== 'unassigned');
      and.push({ OR: [...(ids.length ? [{ assigneeId: { in: ids.map((v) => parseId(v)) } }] : []), ...(q.assigneeIds.includes('unassigned') ? [{ assigneeId: null }] : [])] });
    }
    if (q.labelIds?.length) and.push({ labels: { some: { labelId: { in: q.labelIds.map((v) => parseId(v)) } } } });
    if (q.moduleId) {
      const moduleId = parseId(q.moduleId);
      const scope: Prisma.IssueWhereInput = { OR: [{ modules: { some: { moduleId } } }, { functions: { some: { function: { moduleId, deletedAt: null } } } }, { epicRequirement: { modules: { some: { moduleId } } } }, { epicRequirement: { epicLinks: { some: { function: { moduleId, deletedAt: null } } } } }] };
      and.push({ OR: [scope, { type: 'subtask', parent: { ...scope, deletedAt: null } }] });
    }
    if (q.functionId) {
      const functionId=parseId(q.functionId);
      const scope: Prisma.IssueWhereInput={OR:[{functions:{some:{functionId}}},{epicRequirement:{epicLinks:{some:{functionId}}}}]};
      and.push({ OR: [scope, { type: 'subtask', parent: { ...scope, deletedAt: null } }] });
    }
    if (q.epicId) and.push({ OR: [{ parentId: parseId(q.epicId) }, { parent: { parentId: parseId(q.epicId) } }] });
    if (q.sprintId) and.push({ sprintId: q.sprintId === 'backlog' ? null : parseId(q.sprintId) });
    if (q.source) and.push({ source: q.source });
    return and;
  }

  async list(project: ProjectContext, q: ListIssuesQuery) {
    const limit = clampLimit(q.limit);
    const and = this.filterWhere(project.id, q);
    const cursor = decodeCursor<{ rank: string; id: string }>(q.cursor);
    if (cursor) and.push({ OR: [{ rank: { gt: cursor.rank } }, { rank: cursor.rank, id: { gt: BigInt(cursor.id) } }] });

    const rows = await this.prisma.issue.findMany({ where: { AND: and }, include: issueInclude, orderBy: [{ rank: 'asc' }, { id: 'asc' }], take: limit + 1 });
    const page = toPage(rows, limit, (r) => ({ rank: r.rank, id: r.id.toString() }));
    return { items: page.items.map((r) => toIssueDto(r, project.key)), nextCursor: page.nextCursor };
  }

  async detail(issueKey: string) {
    const issue = await findIssueByKey(this.prisma, issueKey);
    const pk = issue.project.key;
    const [subtasks, linksOut, linksIn, attachments, lastResult] = await Promise.all([
      this.prisma.issue.findMany({ where: { parentId: issue.id, deletedAt: null }, include: issueInclude, orderBy: [{ rank: 'asc' }, { id: 'asc' }] }),
      this.prisma.issueLink.findMany({ where: { sourceId: issue.id, target: { deletedAt: null } }, include: { target: { include: issueInclude } } }),
      this.prisma.issueLink.findMany({ where: { targetId: issue.id, source: { deletedAt: null } }, include: { source: { include: issueInclude } } }),
      this.prisma.attachment.findMany({ where: { entity: 'issue', entityId: issue.id, status: 'ready' }, orderBy: { createdAt: 'asc' } }),
      issue.source === 'auto'
        ? this.prisma.automationResult.findFirst({ where: { issueId: issue.id }, orderBy: { id: 'desc' }, include: { run: true } })
        : null,
    ]);
    const brief = (r: any) => ({ id: r.id, key: issueKeyOf(pk, r.number), title: r.title, type: r.type, status: r.status, priority: r.priority, assignee: r.assignee });
    const transitions = issue.status.category === 'triage' ? [] : await this.workflows.availableTransitions(issue.projectId, issue.statusId);
    return {
      ...toIssueDto(issue, pk),
      subtasks: subtasks.map(brief),
      links: [
        ...linksOut.map((l) => ({ id: l.id, type: l.type, direction: 'outward', issue: brief(l.target) })),
        ...linksIn.map((l) => ({ id: l.id, type: l.type, direction: 'inward', issue: brief(l.source) })),
      ],
      attachments: attachments.map((a) => ({ id: a.id, kind: a.kind, fileName: a.fileName, mimeType: a.mimeType, sizeBytes: a.sizeBytes, createdAt: a.createdAt })),
      availableTransitions: transitions,
      duplicateOf: issue.duplicateOfId ? await this.prisma.issue.findUnique({ where: { id: issue.duplicateOfId }, select: { id: true, number: true, title: true } }).then((d) => d && { id: d.id, key: issueKeyOf(pk, d.number), title: d.title }) : null,
      autoInfo: issue.source === 'auto'
        ? {
            occurrenceCount: issue.occurrenceCount, firstSeenAt: issue.firstSeenAt, lastSeenAt: issue.lastSeenAt, fingerprint: issue.fingerprint,
            lastRun: lastResult ? { id: lastResult.run.id, environment: lastResult.run.environment, branch: lastResult.run.branch, commitSha: lastResult.run.commitSha, ciUrl: lastResult.run.ciUrl } : null,
            file: lastResult?.file ?? null, line: lastResult?.line ?? null, errorMessage: lastResult?.errorMessage ?? null,
          }
        : null,
    };
  }

  // ---------- Ghi ----------

  private async validateParent(tx: Tx, projectId: bigint, type: string, parentKey: string | null | undefined) {
    if (!parentKey) {
      if (type === 'subtask') throw unprocessable(ERROR_CODES.VALIDATION_ERROR, 'Subtask phải có item cha');
      return null;
    }
    if (type === 'epic') throw unprocessable(ERROR_CODES.VALIDATION_ERROR, 'Epic không có item cha');
    const parent = await findIssueByKey(tx, parentKey);
    if (parent.projectId !== projectId) throw unprocessable(ERROR_CODES.VALIDATION_ERROR, 'Item cha phải cùng dự án');
    if (type === 'subtask' && ['epic', 'subtask'].includes(parent.type)) throw unprocessable(ERROR_CODES.VALIDATION_ERROR, 'Subtask phải thuộc story/task/bug');
    if (type !== 'subtask' && parent.type !== 'epic') throw unprocessable(ERROR_CODES.VALIDATION_ERROR, 'Story/task/bug chỉ có thể thuộc một epic');
    return parent;
  }

  private async validateSprint(tx: Tx, projectId: bigint, sprintId: bigint | null | undefined) {
    if (!sprintId) return;
    await tx.$queryRaw`SELECT id FROM projects WHERE id = ${projectId} FOR UPDATE`;
    const sp = await tx.sprint.findFirst({ where: { id: sprintId, projectId, deletedAt: null } });
    if (!sp) throw notFound(ERROR_CODES.SPRINT_NOT_FOUND, 'Không tìm thấy sprint/phase');
    const project = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
    if (sp.kind !== project.trackingMode) throw unprocessable(ERROR_CODES.VALIDATION_ERROR, 'Sprint/phase không thuộc cách theo dõi hiện tại');
    if (sp.state === 'closed') throw unprocessable(ERROR_CODES.VALIDATION_ERROR, 'Sprint/phase đã hoàn thành');
  }

  private async validateUser(tx: Tx, projectId: bigint, userId: bigint | null | undefined) {
    if (!userId) return;
    const u = await tx.user.findUnique({ where: { id: userId } });
    if (!u || !u.isActive) throw notFound(ERROR_CODES.USER_NOT_FOUND, 'Không tìm thấy người dùng');
  }

  async create(project: ProjectContext, dto: CreateIssueDto, actor: Actor) {
    const issue = await this.prisma.$transaction(async (tx) => {
      const settings = await tx.workflowSettings.findUniqueOrThrow({ where: { projectId: project.id } });
      const parent = await this.validateParent(tx, project.id, dto.type, dto.parentKey);
      const sprintId = dto.sprintId ? BigInt(dto.sprintId) : null;
      await this.validateSprint(tx, project.id, sprintId);
      await this.validateUser(tx, project.id, dto.assigneeId ? BigInt(dto.assigneeId) : null);
      const manual = await tx.label.findUniqueOrThrow({ where: { projectId_name: { projectId: project.id, name: 'manual' } } });
      const number = await allocateIssueNumber(tx, project.id);
      const labelIds = new Set<bigint>([manual.id, ...(dto.labelIds ?? []).map((i) => BigInt(i))]);
      if (dto.labelIds?.length) {
        const found = await tx.label.count({ where: { projectId: project.id, id: { in: [...labelIds] } } });
        if (found !== labelIds.size) throw unprocessable(ERROR_CODES.VALIDATION_ERROR, 'Label không thuộc dự án');
      }
      const created = await tx.issue.create({
        data: {
          projectId: project.id, number, type: dto.type, title: dto.title.trim(), description: (dto.description ?? undefined) as any,
          statusId: settings.initialManualStatusId, priority: dto.priority ?? 'medium', source: 'manual',
          assigneeId: dto.assigneeId ? BigInt(dto.assigneeId) : null, reporterId: actor.id, parentId: parent?.id ?? null, sprintId,
          rank: await rankAtEnd(tx, project.id, sprintId), estimateMinutes: dto.estimateMinutes ?? null,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          labels: { create: [...labelIds].map((labelId) => ({ labelId })) },
        },
        include: issueInclude,
      });
      await syncIssueStructure(tx, created.id, project.id, dto.moduleIds, dto.functionIds);
      await recordStatusChange(tx, created.id, null, created.statusId, actor.id);
      await this.activity.log({ projectId: project.id, entity: 'issue', entityId: issueKeyOf(project.key, number), action: 'created', actorId: actor.id, changes: { title: [null, created.title], status: [null, created.status.name] } }, tx);
      return tx.issue.findUniqueOrThrow({ where: { id: created.id }, include: issueInclude });
    });
    return toIssueDto(issue, project.key);
  }

  async update(issueKey: string, dto: UpdateIssueDto, actor: Actor) {
    const result = await this.prisma.$transaction(async (tx) => {
      const issue = await findIssueByKey(tx, issueKey);
      if (issue.version !== dto.version) throw this.versionConflict(issue.version);
      const data: Prisma.IssueUncheckedUpdateManyInput = {};
      const changes: Record<string, [unknown, unknown]> = {};
      const set = (field: string, from: unknown, to: unknown, col?: keyof Prisma.IssueUncheckedUpdateManyInput) => {
        if (JSON.stringify(from) === JSON.stringify(to)) return;
        (data as any)[col ?? field] = to;
        changes[field] = [from, to];
      };
      if (dto.title !== undefined) set('title', issue.title, dto.title.trim());
      if (dto.description !== undefined) set('description', issue.description, dto.description ?? Prisma.JsonNull);
      if (dto.priority !== undefined) set('priority', issue.priority, dto.priority);
      if (dto.estimateMinutes !== undefined) set('estimateMinutes', issue.estimateMinutes, dto.estimateMinutes);
      if (dto.dueDate !== undefined) set('dueDate', issue.dueDate?.toISOString().slice(0, 10) ?? null, dto.dueDate, 'dueDate');
      if ('dueDate' in data) (data as any).dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
      if (dto.assigneeId !== undefined) {
        await this.validateUser(tx, issue.projectId, dto.assigneeId ? BigInt(dto.assigneeId) : null);
        set('assignee', issue.assigneeId, dto.assigneeId === null ? null : BigInt(dto.assigneeId), 'assigneeId');
      }
      if (dto.type !== undefined && dto.type !== issue.type) {
        if (issue.type === 'epic') throw unprocessable(ERROR_CODES.VALIDATION_ERROR, 'Không thể đổi loại Epic dùng chung');
        const hasChildren = await tx.issue.count({ where: { parentId: issue.id, deletedAt: null } });
        if (hasChildren) throw unprocessable(ERROR_CODES.VALIDATION_ERROR, 'Không đổi loại item đang có item con');
        set('type', issue.type, dto.type);
      }
      if (dto.parentKey !== undefined) {
        const type = dto.type ?? issue.type;
        const parent = await this.validateParent(tx, issue.projectId, type, dto.parentKey);
        set('parent', issue.parentId, parent?.id ?? null, 'parentId');
      }
      if (dto.sprintId !== undefined) {
        const sprintId = dto.sprintId === null ? null : BigInt(dto.sprintId);
        if (sprintId && issue.status.category === 'triage') throw unprocessable(ERROR_CODES.TRIAGE_REQUIRED, 'Cần duyệt bug trước');
        await this.validateSprint(tx, issue.projectId, sprintId);
        if (sprintId !== issue.sprintId) {
          set('sprint', issue.sprintId, sprintId, 'sprintId');
          (data as any).rank = await rankAtEnd(tx, issue.projectId, sprintId);
        }
      }
      if(dto.moduleIds !== undefined || dto.functionIds !== undefined) {
        await syncIssueStructure(tx, issue.id, issue.projectId, dto.moduleIds, dto.functionIds);
        const updated = await findIssueByKey(tx, issueKey);
        const ids = (values: bigint[]) => values.map(String).sort();
        const beforeDto=toIssueDto(issue,issue.project.key), afterDto=toIssueDto(updated,issue.project.key);
        const beforeModules=ids(beforeDto.explicitModuleIds), afterModules=ids(afterDto.explicitModuleIds);
        const beforeFunctions=ids(beforeDto.functionIds), afterFunctions=ids(afterDto.functionIds);
        if(beforeModules.join(',') !== afterModules.join(',')) changes.modules=[beforeModules,afterModules];
        if(beforeFunctions.join(',') !== afterFunctions.join(',')) changes.functions=[beforeFunctions,afterFunctions];
      }
      if (dto.labelIds !== undefined) await this.syncLabels(tx, issue.id, issue.projectId, dto.labelIds.map((i) => BigInt(i)), changes);

      if (Object.keys(data).length === 0 && Object.keys(changes).length === 0) return issue;
      const upd = await tx.issue.updateMany({ where: { id: issue.id, version: dto.version }, data: { ...data, version: { increment: 1 }, updatedAt: new Date() } });
      if (upd.count === 0) throw this.versionConflict(issue.version);
      await this.activity.log({ projectId: issue.projectId, entity: 'issue', entityId: issueKey, action: 'updated', actorId: actor.id, changes }, tx);
      return findIssueByKey(tx, issueKey);
    });
    return toIssueDto(result, result.project.key);
  }

  private versionConflict(current: number) {
    return conflict(ERROR_CODES.VERSION_CONFLICT, 'Item vừa được người khác sửa', { currentVersion: current });
  }

  /** Đồng bộ label của item; label hệ thống (manual/auto) luôn được giữ lại. */
  private async syncLabels(tx: Tx, issueId: bigint, projectId: bigint, wanted: bigint[], changes: Record<string, [unknown, unknown]>) {
    const valid = await tx.label.findMany({ where: { projectId, id: { in: wanted } } });
    if (valid.length !== new Set(wanted).size) throw unprocessable(ERROR_CODES.VALIDATION_ERROR, 'Label không thuộc dự án');
    const current = await tx.issueLabel.findMany({ where: { issueId }, include: { label: true } });
    const keep = new Set<bigint>([...current.filter((c) => c.label.isSystem).map((c) => c.labelId), ...valid.filter((v) => !v.isSystem).map((v) => v.id)]);
    const before = current.map((c) => c.label.name).sort();
    const toAdd = [...keep].filter((id) => !current.some((c) => c.labelId === id));
    const toRemove = current.filter((c) => !keep.has(c.labelId)).map((c) => c.labelId);
    if (!toAdd.length && !toRemove.length) return;
    if (toRemove.length) await tx.issueLabel.deleteMany({ where: { issueId, labelId: { in: toRemove } } });
    if (toAdd.length) await tx.issueLabel.createMany({ data: toAdd.map((labelId) => ({ issueId, labelId })) });
    const after = (await tx.issueLabel.findMany({ where: { issueId }, include: { label: true } })).map((c) => c.label.name).sort();
    changes['labels'] = [before, after];
  }

  /** Dùng chung cho transition, triage, bulk, đóng sprint... */
  async moveStatus(tx: Tx, issue: { id: bigint; projectId: bigint; statusId: bigint; version: number; status: { category: string } }, to: { id: bigint; category: string }, actorId: bigint | null, extra: Prisma.IssueUncheckedUpdateManyInput = {}) {
    const data: Prisma.IssueUncheckedUpdateManyInput = { ...extra, statusId: to.id };
    if (to.category === 'done') {
      data.resolvedAt = new Date();
      data.resolution = (extra.resolution as string) ?? 'done';
    } else if (issue.status.category === 'done') {
      data.resolvedAt = null;
      data.resolution = null;
    }
    const upd = await tx.issue.updateMany({ where: { id: issue.id, statusId: issue.statusId }, data: { ...data, version: { increment: 1 }, updatedAt: new Date() } });
    if (upd.count === 0) throw this.versionConflict(issue.version);
    await recordStatusChange(tx, issue.id, issue.statusId, to.id, actorId);
  }

  async transition(issueKey: string, dto: TransitionDto, actor: Actor, role: ProjectRoleName) {
    return this.prisma.$transaction(async (tx) => {
      const issue = await findIssueByKey(tx, issueKey);
      const to = await tx.workflowStatus.findFirst({ where: { id: BigInt(dto.toStatusId), projectId: issue.projectId, isArchived: false } });
      if (!to) throw unprocessable(ERROR_CODES.TRANSITION_NOT_ALLOWED, 'Trạng thái đích không tồn tại');
      const isAdmin = actor.permissions?.includes('workflow.bypass') ?? role === 'admin';
      if (issue.status.category === 'triage' && !isAdmin) {
        throw unprocessable(ERROR_CODES.TRIAGE_REQUIRED, 'Bug cần được duyệt (Accept/Reject/Duplicate) trước');
      }
      const allowed = await this.workflows.isTransitionAllowed(tx, issue.projectId, issue.statusId, to.id);
      if (!allowed && !isAdmin) {
        throw unprocessable(ERROR_CODES.TRANSITION_NOT_ALLOWED, `Không được chuyển từ "${issue.status.name}" sang "${to.name}"`);
      }
      if (issue.statusId === to.id) throw unprocessable(ERROR_CODES.TRANSITION_NOT_ALLOWED, 'Item đã ở trạng thái này');
      await this.moveStatus(tx, issue, to, actor.id);
      await this.activity.log(
        { projectId: issue.projectId, entity: 'issue', entityId: issueKey, action: 'status_changed', actorId: actor.id, changes: { status: [issue.status.name, to.name], ...(allowed ? {} : { bypassedWorkflow: [false, true] }) } },
        tx,
      );
      return toIssueDto(await findIssueByKey(tx, issueKey), issue.project.key);
    });
  }

  async triage(issueKey: string, dto: TriageDto, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const issue = await findIssueByKey(tx, issueKey);
      if (issue.status.category !== 'triage') throw unprocessable(ERROR_CODES.ISSUE_NOT_IN_TRIAGE, 'Item không ở trạng thái chờ duyệt');
      const s = await tx.workflowSettings.findUniqueOrThrow({ where: { projectId: issue.projectId } });
      const statusById = async (id: bigint | null, fallback: bigint) => tx.workflowStatus.findUniqueOrThrow({ where: { id: id ?? fallback } });
      const extra: Prisma.IssueUncheckedUpdateManyInput = {};
      const changes: Record<string, unknown> = {};
      let to;

      if (dto.action === 'accept') {
        to = await statusById(s.acceptStatusId, s.initialManualStatusId);
        if (dto.assigneeId) { await this.validateUser(tx, issue.projectId, BigInt(dto.assigneeId)); extra.assigneeId = BigInt(dto.assigneeId); changes.assignee = [issue.assigneeId, dto.assigneeId]; }
        if (dto.priority) { extra.priority = dto.priority; changes.priority = [issue.priority, dto.priority]; }
        if (dto.sprintId) {
          await this.validateSprint(tx, issue.projectId, BigInt(dto.sprintId));
          extra.sprintId = BigInt(dto.sprintId);
          extra.rank = await rankAtEnd(tx, issue.projectId, BigInt(dto.sprintId));
          changes.sprint = [issue.sprintId, dto.sprintId];
        }
      } else if (dto.action === 'reject') {
        if (!dto.reason?.trim()) throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'Cần nhập lý do từ chối');
        to = await this.rejectStatus(tx, issue.projectId, s.rejectStatusId);
        extra.resolution = 'rejected';
        await tx.issueComment.create({ data: { issueId: issue.id, authorId: actor.id, body: doc(`Từ chối: ${dto.reason.trim()}`) } });
        changes.reason = dto.reason.trim();
      } else {
        if (!dto.duplicateOfKey) throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'Cần chọn bug gốc');
        const original = await findIssueByKey(tx, dto.duplicateOfKey);
        if (original.projectId !== issue.projectId || original.id === issue.id) throw unprocessable(ERROR_CODES.VALIDATION_ERROR, 'Bug gốc không hợp lệ');
        to = await this.rejectStatus(tx, issue.projectId, s.rejectStatusId);
        extra.resolution = 'duplicate';
        extra.duplicateOfId = original.id;
        await tx.issueLink.upsert({
          where: { sourceId_targetId_type: { sourceId: issue.id, targetId: original.id, type: 'duplicates' } },
          update: {}, create: { sourceId: issue.id, targetId: original.id, type: 'duplicates' },
        });
        await tx.issue.update({ where: { id: original.id }, data: { occurrenceCount: { increment: issue.occurrenceCount }, version: { increment: 1 } } });
        changes.duplicateOf = dto.duplicateOfKey;
      }
      await this.moveStatus(tx, issue, to, actor.id, extra);
      await this.activity.log(
        { projectId: issue.projectId, entity: 'issue', entityId: issueKey, action: 'triaged', actorId: actor.id, changes: { action: dto.action, status: [issue.status.name, to.name], ...changes } },
        tx,
      );
      return toIssueDto(await findIssueByKey(tx, issueKey), issue.project.key);
    });
  }

  private async rejectStatus(tx: Tx, projectId: bigint, id: bigint | null) {
    if (id) return tx.workflowStatus.findUniqueOrThrow({ where: { id } });
    const done = await tx.workflowStatus.findFirst({ where: { projectId, category: 'done', isArchived: false }, orderBy: { position: 'desc' } });
    if (!done) throw unprocessable(ERROR_CODES.WORKFLOW_INVALID, 'Dự án chưa có trạng thái done để từ chối');
    return done;
  }

  async rank(issueKey: string, dto: RankDto, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const issue = await findIssueByKey(tx, issueKey);
      let sprintId = issue.sprintId;
      if (dto.sprintId !== undefined) sprintId = dto.sprintId === null ? null : BigInt(dto.sprintId);
      if (sprintId && issue.status.category === 'triage') throw unprocessable(ERROR_CODES.TRIAGE_REQUIRED, 'Cần duyệt bug trước');
      await this.validateSprint(tx, issue.projectId, sprintId);

      const container = { projectId: issue.projectId, sprintId, deletedAt: null, id: { not: issue.id } } as const;
      let prev: string | null = null;
      let next: string | null = null;
      if (dto.afterKey) {
        const a = await findIssueByKey(tx, dto.afterKey);
        prev = a.rank;
        next = (await tx.issue.findFirst({ where: { ...container, rank: { gt: a.rank } }, orderBy: { rank: 'asc' }, select: { rank: true } }))?.rank ?? null;
      } else if (dto.beforeKey) {
        const b = await findIssueByKey(tx, dto.beforeKey);
        next = b.rank;
        prev = (await tx.issue.findFirst({ where: { ...container, rank: { lt: b.rank } }, orderBy: { rank: 'desc' }, select: { rank: true } }))?.rank ?? null;
      } else {
        prev = (await tx.issue.findFirst({ where: container, orderBy: { rank: 'desc' }, select: { rank: true } }))?.rank ?? null;
      }
      const rank = safeRankBetween(prev, next);
      await tx.issue.update({ where: { id: issue.id }, data: { rank, sprintId, version: { increment: 1 } } });
      if (sprintId !== issue.sprintId) {
        await this.activity.log({ projectId: issue.projectId, entity: 'issue', entityId: issueKey, action: 'updated', actorId: actor.id, changes: { sprint: [issue.sprintId, sprintId] } }, tx);
      }
      return { key: issueKey, rank, sprintId };
    });
  }

  async bulk(project: ProjectContext, dto: BulkIssuesDto, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const out: string[] = [];
      for (const key of dto.issueKeys) {
        const issue = await findIssueByKey(tx, key);
        if (issue.projectId !== project.id) throw forbidden('Item không thuộc dự án');
        const changes: Record<string, [unknown, unknown]> = {};
        const extra: Prisma.IssueUncheckedUpdateManyInput = {};
        if (dto.set.deleted) {
          if (issue.type === 'epic') await guardEpicDeletion(tx, issue.id);
          if (!(project.permissions?.includes('issue.delete.any') ?? project.role === 'admin') && issue.reporterId !== actor.id) throw forbidden('Chỉ xóa được item do bạn tạo');
          await tx.issue.update({ where: { id: issue.id }, data: { deletedAt: new Date(), version: { increment: 1 } } });
          await this.activity.log({ projectId: project.id, entity: 'issue', entityId: key, action: 'deleted', actorId: actor.id }, tx);
          out.push(key);
          continue;
        }
        if(dto.set.moduleIds !== undefined || dto.set.functionIds !== undefined) {
          await syncIssueStructure(tx,issue.id,project.id,dto.set.moduleIds,dto.set.functionIds);
          const before=toIssueDto(issue,project.key);
          changes.structure=[{moduleIds:before.explicitModuleIds.map(String),functionIds:before.functionIds.map(String)},{moduleIds:dto.set.moduleIds,functionIds:dto.set.functionIds}];
        }
        if (dto.set.priority) { extra.priority = dto.set.priority; changes.priority = [issue.priority, dto.set.priority]; }
        if (dto.set.assigneeId !== undefined) {
          await this.validateUser(tx, project.id, dto.set.assigneeId ? BigInt(dto.set.assigneeId) : null);
          extra.assigneeId = dto.set.assigneeId === null ? null : BigInt(dto.set.assigneeId);
          changes.assignee = [issue.assigneeId, extra.assigneeId];
        }
        if (dto.set.sprintId !== undefined) {
          const sprintId = dto.set.sprintId === null ? null : BigInt(dto.set.sprintId);
          if (sprintId && issue.status.category === 'triage') throw unprocessable(ERROR_CODES.TRIAGE_REQUIRED, `${key}: cần duyệt bug trước`);
          await this.validateSprint(tx, project.id, sprintId);
          if (sprintId !== issue.sprintId) { extra.sprintId = sprintId; extra.rank = await rankAtEnd(tx, project.id, sprintId); changes.sprint = [issue.sprintId, sprintId]; }
        }
        if (dto.set.labelIds?.length) {
          const wanted = new Set([...(await tx.issueLabel.findMany({ where: { issueId: issue.id } })).map((l) => l.labelId), ...dto.set.labelIds.map((i) => BigInt(i))]);
          await this.syncLabels(tx, issue.id, project.id, [...wanted], changes);
        }
        if (dto.set.statusId) {
          const to = await tx.workflowStatus.findFirst({ where: { id: BigInt(dto.set.statusId), projectId: project.id, isArchived: false } });
          if (!to) throw unprocessable(ERROR_CODES.TRANSITION_NOT_ALLOWED, 'Trạng thái đích không tồn tại');
          const bypass = project.permissions?.includes('workflow.bypass') ?? project.role === 'admin';
          if (issue.status.category === 'triage' && !bypass) throw unprocessable(ERROR_CODES.TRIAGE_REQUIRED, `${key}: cần duyệt bug trước`);
          if (issue.statusId !== to.id) {
            if (!(await this.workflows.isTransitionAllowed(tx, project.id, issue.statusId, to.id)) && !bypass) {
              throw unprocessable(ERROR_CODES.TRANSITION_NOT_ALLOWED, `${key}: không được chuyển từ "${issue.status.name}" sang "${to.name}"`);
            }
            await this.moveStatus(tx, issue, to, actor.id, extra);
            changes.status = [issue.status.name, to.name];
            await this.activity.log({ projectId: project.id, entity: 'issue', entityId: key, action: 'status_changed', actorId: actor.id, changes }, tx);
            out.push(key);
            continue;
          }
        }
        if (Object.keys(extra).length || Object.keys(changes).length) {
          await tx.issue.update({ where: { id: issue.id }, data: { ...(extra as any), version: { increment: 1 } } });
          await this.activity.log({ projectId: project.id, entity: 'issue', entityId: key, action: 'updated', actorId: actor.id, changes }, tx);
        }
        out.push(key);
      }
      return { updated: out };
    });
  }

  async remove(issueKey: string, actor: Actor, role: ProjectRoleName) {
    const issue = await findIssueByKey(this.prisma, issueKey);
    if (!(actor.permissions?.includes('issue.delete.any') ?? role === 'admin') && issue.reporterId !== actor.id) throw forbidden('Chỉ xóa được item do bạn tạo');
    await this.prisma.$transaction(async (tx) => {
      if (issue.type === 'epic') await guardEpicDeletion(tx, issue.id);
      await tx.issue.update({ where: { id: issue.id }, data: { deletedAt: new Date(), version: { increment: 1 } } });
      await this.activity.log({ projectId: issue.projectId, entity: 'issue', entityId: issueKey, action: 'deleted', actorId: actor.id }, tx);
    });
  }

  // ---------- Comment ----------

  async listComments(issueKey: string) {
    const issue = await findIssueByKey(this.prisma, issueKey);
    return this.prisma.issueComment.findMany({
      where: { issueId: issue.id, deletedAt: null }, orderBy: { createdAt: 'asc' },
      include: { author: { select: { id: true, displayName: true, avatarUrl: true } } },
    });
  }

  async addComment(issueKey: string, body: Record<string, unknown>, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const issue = await findIssueByKey(tx, issueKey);
      const c = await tx.issueComment.create({ data: { issueId: issue.id, authorId: actor.id, body: body as any }, include: { author: { select: { id: true, displayName: true, avatarUrl: true } } } });
      await tx.issue.update({ where: { id: issue.id }, data: { updatedAt: new Date() } });
      await this.activity.log({ projectId: issue.projectId, entity: 'issue', entityId: issueKey, action: 'commented', actorId: actor.id }, tx);
      return c;
    });
  }

  private async ownComment(id: bigint, actor: Actor, role: ProjectRoleName) {
    const c = await this.prisma.issueComment.findFirst({ where: { id, deletedAt: null } });
    if (!c) throw notFound(ERROR_CODES.NOT_FOUND, 'Không tìm thấy comment');
    if (c.authorId !== actor.id && role !== 'admin') throw forbidden('Chỉ sửa/xóa được comment của mình');
    return c;
  }

  async updateComment(id: bigint, body: Record<string, unknown>, actor: Actor, role: ProjectRoleName) {
    await this.ownComment(id, actor, role);
    return this.prisma.issueComment.update({ where: { id }, data: { body: body as any } });
  }

  async deleteComment(id: bigint, actor: Actor, role: ProjectRoleName) {
    await this.ownComment(id, actor, role);
    await this.prisma.issueComment.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  // ---------- Link, activity ----------

  async addLink(issueKey: string, targetKey: string, type: string, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const [a, b] = [await findIssueByKey(tx, issueKey), await findIssueByKey(tx, targetKey)];
      if (a.id === b.id || a.projectId !== b.projectId) throw unprocessable(ERROR_CODES.VALIDATION_ERROR, 'Liên kết không hợp lệ');
      const link = await tx.issueLink.upsert({
        where: { sourceId_targetId_type: { sourceId: a.id, targetId: b.id, type } }, update: {}, create: { sourceId: a.id, targetId: b.id, type },
      });
      await this.activity.log({ projectId: a.projectId, entity: 'issue', entityId: issueKey, action: 'linked', actorId: actor.id, changes: { link: [null, `${type} ${targetKey}`] } }, tx);
      return link;
    });
  }

  async removeLink(issueKey: string, linkId: bigint, actor: Actor) {
    const issue = await findIssueByKey(this.prisma, issueKey);
    const link = await this.prisma.issueLink.findFirst({ where: { id: linkId, OR: [{ sourceId: issue.id }, { targetId: issue.id }] } });
    if (!link) throw notFound(ERROR_CODES.NOT_FOUND, 'Không tìm thấy liên kết');
    await this.prisma.issueLink.delete({ where: { id: link.id } });
    await this.activity.log({ projectId: issue.projectId, entity: 'issue', entityId: issueKey, action: 'unlinked', actorId: actor.id, changes: { link: [link.type, null] } });
  }

  async activityFor(issueKey: string, cursor?: string, limitIn?: number) {
    const issue = await findIssueByKey(this.prisma, issueKey);
    const limit = clampLimit(limitIn);
    const c = decodeCursor<{ id: string }>(cursor);
    const rows = await this.prisma.activityLog.findMany({
      where: { entity: 'issue', entityId: issueKey, ...(c ? { id: { lt: BigInt(c.id) } } : {}) },
      include: { actor: { select: { id: true, displayName: true, avatarUrl: true } }, apiKey: { select: { id: true, name: true } } },
      orderBy: { id: 'desc' }, take: limit + 1,
    });
    void issue;
    return toPage(rows, limit, (r) => ({ id: r.id.toString() }));
  }
}

export { AppException };
