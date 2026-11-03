import { Injectable, OnModuleInit } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { ERROR_CODES, Permission, normalizePermissions, rankBetween } from '@ospm/shared';
import { PrismaService, Tx } from '../common/prisma.service';
import { conflict, forbidden, notFound, unprocessable } from '../common/errors';
import { builtinPermissions } from '../roles/builtin-roles';
import { StorageService } from '../attachments/storage.service';
import { JobsService } from '../jobs/jobs.service';
import { JOBS, QueueService } from '../queue/queue.service';
import { allocateIssueNumber, doc, rankAtEnd } from '../issues/issue-core';
import { syncIssueStructure } from '../issues/issue-structure';
import { ImportScope, ParsedProjectWorkbook, parseProjectWorkbook } from './import-workbook';

const text = (v: unknown) => String(v ?? '').trim();
const supplied = (v: unknown) => text(v) !== '';
const clear = (v: unknown) => text(v) === '[CLEAR]';
const list = (v: unknown) => (clear(v) ? [] : [...new Set(text(v).split(/[,;]/).map(text).filter(Boolean))]);
const json = (v: unknown) =>
  JSON.parse(JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x)));
const counts = () => ({
  modules: { create: 0, update: 0 },
  epics: { create: 0, update: 0 },
  functions: { create: 0, update: 0 },
  backlog: { create: 0, update: 0 },
});
const buckets = { module: 'modules', epic: 'epics', function: 'functions', backlog: 'backlog' } as const;
type Actor = { id: bigint; systemRole: string };
type JobData = {
  projectId: string;
  userId: string;
  scope: ImportScope;
  objectKey?: string;
  fileName?: string;
  sessionId?: string;
  hasStructure?: boolean;
};

/** The durable session holds the server's immutable parsed workbook and reviewed snapshot. */
@Injectable()
export class ProjectImportService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly jobs: JobsService,
    private readonly queue: QueueService,
  ) {}
  onModuleInit() {
    this.jobs.register(JOBS.PROJECT_IMPORT_PREVIEW, (d) => this.runPreview(d));
    this.jobs.register(JOBS.PROJECT_IMPORT_COMMIT, (d) => this.runCommit(d));
  }
  async permissions(db: Tx, actor: Actor, projectId: bigint, scope: ImportScope, hasStructure = false) {
    const user = await db.user.findUnique({ where: { id: actor.id } });
    const project = await db.project.findFirst({ where: { id: projectId, deletedAt: null } });
    if (!user?.isActive || !project) throw forbidden('Project or actor is no longer available');
    let permissions: Permission[];
    if (user.systemRole === 'admin')
      permissions = normalizePermissions([
        'project.structure.import',
        'issue.import',
        'issue.transition',
        'workflow.bypass',
      ]);
    else {
      const member = await db.projectMember.findFirst({
        where: { projectId, userId: user.id, leftAt: null },
        include: { roleDefinition: true },
      });
      if (!member) throw forbidden();
      permissions = member.roleId
        ? normalizePermissions(member.roleDefinition?.permissions ?? [])
        : await builtinPermissions(db, member.role as any);
    }
    const required: Permission[] = [scope === 'structure' ? 'project.structure.import' : 'issue.import'];
    if (hasStructure && scope === 'backlog') required.push('project.structure.import');
    if (required.some((p) => !permissions.includes(p)))
      throw forbidden('Import permission is required for every populated sheet');
    return { project, permissions };
  }
  async authorize(actor: Actor, projectId: bigint, scope: ImportScope, hasStructure = false) {
    return this.permissions(this.prisma, actor, projectId, scope, hasStructure);
  }
  async enqueuePreview(
    projectId: bigint,
    userId: bigint,
    scope: ImportScope,
    objectKey: string,
    fileName: string,
  ) {
    return this.queue.send(JOBS.PROJECT_IMPORT_PREVIEW, {
      projectId: String(projectId),
      userId: String(userId),
      scope,
      objectKey,
      fileName,
    });
  }
  async session(actor: Actor, projectId: bigint, id: string) {
    const s = await this.prisma.projectImportSession.findUnique({ where: { id } }).catch(() => null);
    if (!s || s.projectId !== projectId) throw notFound(ERROR_CODES.NOT_FOUND, 'Import session not found');
    if (s.ownerId !== actor.id) throw forbidden('Only the preview owner can commit');
    const payload = s.payload as unknown as ParsedProjectWorkbook;
    const access = await this.authorize(
      actor,
      projectId,
      s.scope as ImportScope,
      payload.rows.some((r) => r.entity !== 'backlog'),
    );
    this.requireReviewedPermissions(access.permissions, s.preview);
    if (!s.result && s.expiresAt.getTime() <= Date.now())
      throw unprocessable(ERROR_CODES.IMPORT_INVALID, 'Import preview expired; upload the file again');
    if (!(s.preview as any).canCommit)
      throw unprocessable(ERROR_CODES.IMPORT_INVALID, 'Correct the preview errors before committing');
    return s;
  }
  private requireReviewedPermissions(permissions: Permission[], preview: unknown) {
    for (const required of (preview as any).requiredPermissions ?? []) {
      if (!permissions.includes(required)) throw forbidden(`Import requires current ${required} permission`);
    }
  }
  async authorizeJob(
    actor: Actor,
    projectId: bigint,
    scope: ImportScope,
    hasStructure: boolean,
    sessionId?: string,
  ) {
    const access = await this.authorize(actor, projectId, scope, hasStructure);
    if (sessionId) {
      const s = await this.prisma.projectImportSession.findUnique({ where: { id: sessionId } });
      if (!s || s.ownerId !== actor.id || s.projectId !== projectId) throw forbidden();
      this.requireReviewedPermissions(access.permissions, s.preview);
    }
  }
  async enqueueCommit(actor: Actor, projectId: bigint, id: string) {
    const s = await this.session(actor, projectId, id);
    return this.queue.send(JOBS.PROJECT_IMPORT_COMMIT, {
      projectId: String(projectId),
      userId: String(actor.id),
      scope: s.scope,
      sessionId: id,
      hasStructure: (s.payload as any).rows.some((r: any) => r.entity !== 'backlog'),
    });
  }
  async runPreview(d: JobData) {
    const projectId = BigInt(d.projectId),
      actor = { id: BigInt(d.userId), systemRole: '' };
    await this.authorize(actor, projectId, d.scope);
    let parsed: ParsedProjectWorkbook;
    try {
      parsed = await parseProjectWorkbook(await this.storage.getObject(d.objectKey!), d.scope);
    } catch {
      parsed = {
        rows: [],
        errors: [{ sheet: 'Workbook', message: 'Cannot read the .xlsx workbook' }],
        warnings: [],
      };
    }
    const out = await this.prisma.$transaction(
      async (tx) => {
        const { project, permissions } = await this.permissions(
          tx,
          actor,
          projectId,
          d.scope,
          parsed.rows.some((r) => r.entity !== 'backlog'),
        );
        const state = await this.state(tx, projectId);
        const preview = this.validate(parsed, state, project, permissions);
        const requiredPermissions = new Set<Permission>();
        if (preview.canCommit)
          for (const row of parsed.rows) {
            if (row.entity !== 'backlog' || !supplied(row.values.status)) continue;
            const old = state.issues.find((i) => `${project.key}-${i.number}` === text(row.values.itemKey));
            const from = old?.statusId ?? state.settings?.initialManualStatusId;
            const to = state.statuses.find((s) => s.name === text(row.values.status));
            if (!to || to.id === from) continue;
            requiredPermissions.add('issue.transition');
            const triage = state.statuses.find((s) => s.id === from)?.category === 'triage';
            if (
              triage ||
              (!state.settings?.allowAnyTransition &&
                !state.transitions.some(
                  (t) => t.toStatusId === to.id && (t.fromStatusId === null || t.fromStatusId === from),
                ))
            )
              requiredPermissions.add('workflow.bypass');
          }
        const s = await tx.projectImportSession.create({
          data: {
            projectId,
            ownerId: actor.id,
            scope: d.scope,
            fileName: d.fileName!,
            payload: json(parsed),
            preview: json({ ...preview, requiredPermissions: [...requiredPermissions] }),
            snapshot: this.hash(state),
            expiresAt: new Date(Date.now() + 86400_000),
          },
        });
        return { sessionId: s.id, fileName: s.fileName, scope: d.scope, ...preview };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 60000 },
    );
    return out;
  }
  private async state(db: Tx, projectId: bigint) {
    const orderBy = { id: 'asc' as const };
    const [
      modules,
      requirements,
      issues,
      periods,
      statuses,
      settings,
      transitions,
      members,
      links,
      epicModules,
      sources,
      itemModules,
      itemFunctions,
    ] = await Promise.all([
      db.projectModule.findMany({ where: { projectId }, orderBy }),
      db.requirement.findMany({ where: { projectId }, orderBy }),
      db.issue.findMany({ where: { projectId }, orderBy }),
      db.sprint.findMany({ where: { projectId }, orderBy }),
      db.workflowStatus.findMany({ where: { projectId }, orderBy }),
      db.workflowSettings.findUnique({ where: { projectId } }),
      db.workflowTransition.findMany({ where: { projectId }, orderBy }),
      db.projectMember.findMany({ where: { projectId, leftAt: null }, include: { user: true }, orderBy }),
      db.requirementLink.findMany({
        where: { epic: { projectId } },
        orderBy: [{ epicId: 'asc' }, { functionId: 'asc' }],
      }),
      db.epicModule.findMany({
        where: { epic: { projectId } },
        orderBy: [{ epicId: 'asc' }, { moduleId: 'asc' }],
      }),
      db.requirementSource.findMany({ where: { requirement: { projectId } }, orderBy }),
      db.issueModule.findMany({
        where: { issue: { projectId } },
        orderBy: [{ issueId: 'asc' }, { moduleId: 'asc' }],
      }),
      db.issueFunction.findMany({
        where: { issue: { projectId } },
        orderBy: [{ issueId: 'asc' }, { functionId: 'asc' }],
      }),
    ]);
    // Never persist password hashes or transient login timestamps in preview snapshots.
    const project = await db.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { key: true, trackingMode: true, deletedAt: true },
    });
    return {
      project,
      modules,
      requirements,
      issues,
      periods,
      statuses,
      settings,
      transitions,
      members: members.map((m) => ({
        id: m.id,
        userId: m.userId,
        user: { id: m.user.id, email: m.user.email, isActive: m.user.isActive },
      })),
      links,
      epicModules,
      sources,
      itemModules,
      itemFunctions,
    };
  }
  private hash(state: unknown) {
    return createHash('sha256')
      .update(JSON.stringify(json(state)))
      .digest('hex');
  }
  private validate(
    parsed: ParsedProjectWorkbook,
    state: Awaited<ReturnType<ProjectImportService['state']>>,
    project: { key: string; trackingMode: string },
    permissions: Permission[],
  ) {
    const errors = [...parsed.errors];
    const warnings = [...parsed.warnings];
    const total = counts();
    const rows = parsed.rows.map((r) => ({
      sheet: r.sheet,
      row: r.row,
      entity: r.entity,
      code: text(r.values.code) || text(r.values.itemKey) || text(r.values.ref),
      action: 'create' as 'create' | 'update' | 'error',
      summary: text(r.values.name) || text(r.values.title),
      errors: [] as string[],
    }));
    const fail = (i: number, column: string, message: string) => {
      rows[i].errors.push(message);
      errors.push({ sheet: rows[i].sheet, row: rows[i].row, column, message });
    };
    const moduleMap = new Map(state.modules.map((m) => [m.code, m]));
    const reqMap = new Map(state.requirements.map((r) => [r.code, r]));
    const issueMap = new Map(state.issues.map((i) => [`${project.key}-${i.number}`, i]));
    const declared = new Map<string, number>();
    const refs = new Map<string, number>();
    const itemRows = new Map<string, number>();
    const existing = parsed.rows.map((r, i) => {
      const v = r.values,
        code = text(v.code),
        key = text(v.itemKey);
      let found: any;
      if (r.entity === 'backlog') {
        if (key) {
          found = issueMap.get(key);
          if (!found) fail(i, 'itemKey', `Unknown itemKey ${key} in this project`);
          if (itemRows.has(key)) fail(i, 'itemKey', `Duplicate itemKey ${key}`);
          itemRows.set(key, i);
        }
        const ref = text(v.ref);
        if (ref) {
          if (refs.has(ref) || issueMap.has(ref)) fail(i, 'ref', `Duplicate or ambiguous ref ${ref}`);
          refs.set(ref, i);
        }
      } else {
        if (!code || clear(code)) fail(i, 'code', 'A nonblank code is required');
        const identity = `${r.entity === 'module' ? 'module' : 'requirement'}:${code}`;
        if (declared.has(identity)) fail(i, 'code', `Duplicate code ${code}`);
        declared.set(identity, i);
        found = r.entity === 'module' ? moduleMap.get(code) : reqMap.get(code);
        if (found && r.entity !== 'module' && found.kind !== r.entity)
          fail(i, 'code', `Code ${code} belongs to another entity type`);
      }
      if (found?.deletedAt)
        fail(
          i,
          r.entity === 'backlog' ? 'itemKey' : 'code',
          'Deleted identity cannot be imported or restored',
        );
      if (found) rows[i].action = 'update';
      if (r.entity === 'backlog') {
        if (!found && !supplied(v.title)) fail(i, 'title', 'Title is required for a new item');
        if (clear(v.title) || text(v.title).length > 255)
          fail(i, 'title', 'Title must contain 1–255 characters');
        const type = text(v.type).toLowerCase() || found?.type || 'task';
        if (!['epic', 'story', 'task', 'bug', 'subtask'].includes(type))
          fail(i, 'type', `Unknown item type ${type}`);
        if (found && supplied(v.type) && type !== found.type)
          fail(i, 'type', 'Existing item type cannot change');
        if (
          type === 'epic' &&
          ((supplied(v.parent) && !clear(v.parent)) || (supplied(v.epicCode) && !clear(v.epicCode)))
        )
          fail(i, 'parent', 'Epic cannot have a parent');
        if (
          supplied(v.priority) &&
          !['highest', 'high', 'medium', 'low', 'lowest'].includes(text(v.priority))
        )
          fail(i, 'priority', 'Unknown priority');
        if (
          supplied(v.estimateMinutes) &&
          !clear(v.estimateMinutes) &&
          (!/^\d+$/.test(text(v.estimateMinutes)) || Number(v.estimateMinutes) > 2147483647)
        )
          fail(i, 'estimateMinutes', 'Estimate must be a nonnegative integer');
        if (
          supplied(v.dueDate) &&
          !clear(v.dueDate) &&
          (!/^\d{4}-\d{2}-\d{2}$/.test(text(v.dueDate)) ||
            !Number.isFinite(Date.parse(text(v.dueDate))) ||
            new Date(text(v.dueDate)).toISOString().slice(0, 10) !== text(v.dueDate))
        )
          fail(i, 'dueDate', 'Use a valid YYYY-MM-DD date');
        if (
          supplied(v.assignee) &&
          !clear(v.assignee) &&
          state.members.filter((m) => m.user.isActive && m.user.email === text(v.assignee)).length !== 1
        )
          fail(i, 'assignee', 'Assignee must be an active project member email');
        if (
          supplied(v.period) &&
          !clear(v.period) &&
          state.periods.filter(
            (p) =>
              !p.deletedAt &&
              p.state !== 'closed' &&
              p.kind === project.trackingMode &&
              p.name === text(v.period),
          ).length !== 1
        )
          fail(i, 'period', 'Period must uniquely name an open period in the current tracking mode');
        const status = supplied(v.status)
          ? state.statuses.find((s) => !s.isArchived && s.name === text(v.status))
          : undefined;
        if (supplied(v.status) && !status) fail(i, 'status', `Unknown active status ${text(v.status)}`);
        const from = found?.statusId ?? state.settings?.initialManualStatusId;
        const fromCategory = state.statuses.find((s) => s.id === from)?.category;
        if (supplied(v.period) && !clear(v.period) && fromCategory === 'triage')
          fail(i, 'period', 'Triage items must be accepted before period assignment');
        if (status && status.id !== from) {
          if (fromCategory === 'triage' && !permissions.includes('workflow.bypass'))
            fail(i, 'status', 'Triage items must be accepted before status changes');
          if (!permissions.includes('issue.transition'))
            fail(i, 'status', 'Status changes require issue.transition');
          if (
            !permissions.includes('workflow.bypass') &&
            !state.settings?.allowAnyTransition &&
            !state.transitions.some(
              (t) => t.toStatusId === status.id && (t.fromStatusId === null || t.fromStatusId === from),
            )
          )
            fail(i, 'status', 'Workflow does not allow this transition');
        }
        if (!state.settings) fail(i, 'status', 'Project has no workflow settings');
      } else {
        if (!found && !supplied(v.name)) fail(i, 'name', 'Name is required for a new entity');
        if (clear(v.name)) fail(i, 'name', 'Name cannot be cleared');
      }
      return found;
    });
    const metadata = (i: number, column: string, entity: 'module' | 'epic' | 'function', single = false) => {
      const value = parsed.rows[i].values[column];
      if (!supplied(value) || clear(value)) return;
      const codes = single ? [text(value)] : list(value);
      for (const code of codes) {
        const actual = entity === 'module' ? moduleMap.get(code) : reqMap.get(code);
        const declaration = declared.get(`${entity === 'module' ? 'module' : 'requirement'}:${code}`);
        if (
          actual?.deletedAt ||
          (actual && entity !== 'module' && (actual as any).kind !== entity) ||
          (!actual && (declaration === undefined || parsed.rows[declaration].entity !== entity))
        )
          fail(i, column, `Unknown active ${entity} code ${code}`);
      }
    };
    const parentTargets = new Map<number, { row?: number; item?: any } | null>();
    parsed.rows.forEach((r, i) => {
      const v = r.values;
      if (r.entity === 'function') {
        metadata(i, 'moduleCode', 'module', true);
        metadata(i, 'epicCodes', 'epic');
      } else {
        metadata(i, 'moduleCodes', 'module');
        metadata(i, 'functionCodes', 'function');
      }
      if (r.entity !== 'backlog') return;
      metadata(i, 'epicCode', 'epic', true);
      let target: { row?: number; item?: any } | null = null;
      if (supplied(v.parent) && !clear(v.parent)) {
        const p = text(v.parent),
          local = refs.get(p) ?? itemRows.get(p),
          item = issueMap.get(p);
        if (local !== undefined) target = { row: local };
        else if (item && !item.deletedAt) target = { item };
        else fail(i, 'parent', `Unknown active parent ${p}`);
      } else if (!supplied(v.parent) && existing[i]?.parentId)
        target = { item: state.issues.find((x) => x.id === existing[i].parentId) };
      if (supplied(v.epicCode) && !clear(v.epicCode)) {
        if (clear(v.parent)) fail(i, 'parent', 'Cannot clear parent and also supply an epicCode');
        const code = text(v.epicCode),
          req = reqMap.get(code),
          local = declared.get(`requirement:${code}`);
        const epicTarget =
          local !== undefined
            ? { row: local }
            : { item: state.issues.find((x) => x.id === req?.epicIssueId) };
        if (supplied(v.parent) && !clear(v.parent)) {
          const targetId =
            target?.item?.id ?? (target?.row !== undefined ? existing[target.row]?.id : undefined);
          if (targetId !== req?.epicIssueId || !req)
            fail(i, 'epicCode', 'Parent and epicCode must identify the same Epic');
        } else target = epicTarget;
      } else if (clear(v.epicCode) && !supplied(v.parent)) target = null;
      parentTargets.set(i, target);
      const type = text(v.type).toLowerCase() || existing[i]?.type || 'task';
      const parentType =
        target?.row !== undefined
          ? parsed.rows[target.row].entity === 'epic'
            ? 'epic'
            : text(parsed.rows[target.row].values.type).toLowerCase() || existing[target.row]?.type || 'task'
          : target?.item?.type;
      if (type === 'subtask' && !target) fail(i, 'parent', 'Subtask requires a Story, Task or Bug parent');
      if (
        target &&
        (type === 'epic' ||
          (type === 'subtask' ? !['story', 'task', 'bug'].includes(parentType) : parentType !== 'epic'))
      )
        fail(i, 'parent', 'Parent violates Epic → Story/Task/Bug → Subtask hierarchy');
    });
    // Two populated declarations of the same edge must agree, independently of sheet order.
    parsed.rows.forEach((r, i) => {
      if (r.entity !== 'function' || !supplied(r.values.epicCodes)) return;
      parsed.rows.forEach((e, j) => {
        if (e.entity !== 'epic' || !supplied(e.values.functionCodes)) return;
        if (
          list(r.values.epicCodes).includes(text(e.values.code)) !==
          list(e.values.functionCodes).includes(text(r.values.code))
        ) {
          fail(i, 'epicCodes', 'Conflicting Epic/Function relationship declarations');
          fail(j, 'functionCodes', 'Conflicting Epic/Function relationship declarations');
        }
      });
    });
    for (const error of parsed.errors) {
      const i = rows.findIndex((r) => r.sheet === error.sheet && r.row === error.row);
      if (i >= 0 && !rows[i].errors.includes(error.message)) rows[i].errors.push(error.message);
    }
    for (const [i] of parentTargets) {
      const seen = new Set<string>();
      let target: { row?: number; item?: any } | null = { row: i };
      while (target) {
        const row: number | undefined = target.row,
          item: any = target.item;
        const key = row !== undefined ? `row:${row}` : `id:${item?.id}`;
        if (seen.has(key)) {
          fail(i, 'parent', 'Parent cycle detected');
          break;
        }
        seen.add(key);
        if (row !== undefined) target = parentTargets.get(row) ?? null;
        else if (item?.parentId) {
          const local = itemRows.get(`${project.key}-${item.number}`);
          target =
            local !== undefined ? { row: local } : { item: state.issues.find((x) => x.id === item.parentId) };
        } else target = null;
      }
    }
    rows.forEach((r) => {
      if (r.errors.length) r.action = 'error';
      else total[buckets[r.entity]][r.action as 'create' | 'update']++;
    });
    if (!parsed.rows.length && !errors.length)
      errors.push({ sheet: 'Workbook', message: 'Workbook contains no data rows' });
    return { canCommit: errors.length === 0, counts: total, rows, errors, warnings };
  }
  async runCommit(d: JobData) {
    const actor = { id: BigInt(d.userId), systemRole: '' },
      projectId = BigInt(d.projectId);
    return this.prisma.$transaction(
      async (tx) => {
        // A row lock makes concurrent jobs and retries return exactly one durable result.
        await tx.$queryRaw`SELECT id FROM project_import_sessions WHERE id = ${d.sessionId}::uuid FOR UPDATE`;
        const s = await tx.projectImportSession.findUnique({ where: { id: d.sessionId! } });
        if (!s || s.projectId !== projectId || s.ownerId !== actor.id)
          throw forbidden('Import session ownership mismatch');
        const parsed = s.payload as unknown as ParsedProjectWorkbook;
        const access = await this.permissions(
          tx,
          actor,
          projectId,
          s.scope as ImportScope,
          parsed.rows.some((r) => r.entity !== 'backlog'),
        );
        this.requireReviewedPermissions(access.permissions, s.preview);
        if (s.result) return s.result;
        if (s.expiresAt.getTime() <= Date.now())
          throw unprocessable(ERROR_CODES.IMPORT_INVALID, 'Import preview expired');
        // Serialize domain writers while checking snapshots and applying the plan. PostgreSQL
        // writers take ROW EXCLUSIVE locks, so none can change a reference after this check.
        await tx.$executeRawUnsafe(
          'LOCK TABLE projects, project_modules, requirements, issues, sprints, workflow_statuses, workflow_settings, workflow_transitions, project_members, users, role_definitions, requirement_links, epic_modules, requirement_sources, issue_modules, issue_functions IN SHARE ROW EXCLUSIVE MODE',
        );
        const { project, permissions } = await this.permissions(
          tx,
          actor,
          projectId,
          s.scope as ImportScope,
          parsed.rows.some((r) => r.entity !== 'backlog'),
        );
        this.requireReviewedPermissions(permissions, s.preview);
        const state = await this.state(tx, projectId);
        if (this.hash(state) !== s.snapshot)
          throw conflict('IMPORT_STALE', 'Import preview is stale; data changed, upload the file again');
        const preview = this.validate(parsed, state, project, permissions);
        if (!preview.canCommit)
          throw unprocessable(ERROR_CODES.IMPORT_INVALID, 'Import is no longer valid', preview.errors);
        const result = await this.apply(tx, project, actor.id, parsed, preview);
        const output = json({ sessionId: s.id, ...result, completedAt: new Date().toISOString() });
        await tx.projectImportSession.update({ where: { id: s.id }, data: { result: output } });
        return output;
      },
      { timeout: 120000, maxWait: 30000 },
    );
  }
  private async apply(
    tx: Tx,
    project: { id: bigint; key: string; trackingMode: string },
    actorId: bigint,
    parsed: ParsedProjectWorkbook,
    preview: ReturnType<ProjectImportService['validate']>,
  ) {
    const ids = new Map<number, bigint>();
    const changedEpicIds = new Set<bigint>();
    const mods = new Map(
      (await tx.projectModule.findMany({ where: { projectId: project.id, deletedAt: null } })).map((r) => [
        r.code,
        r.id,
      ]),
    );
    const reqs = new Map(
      (await tx.requirement.findMany({ where: { projectId: project.id, deletedAt: null } })).map((r) => [
        r.code,
        r,
      ]),
    );
    const issueKeys = new Map(
      (await tx.issue.findMany({ where: { projectId: project.id, deletedAt: null } })).map((r) => [
        `${project.key}-${r.number}`,
        r,
      ]),
    );
    const settings = await tx.workflowSettings.findUniqueOrThrow({ where: { projectId: project.id } });
    const fields = (v: Record<string, string | number>, key: string) =>
      supplied(v[key]) ? (clear(v[key]) ? null : text(v[key])) : undefined;
    // Allocate metadata before resolving any cross-sheet relationship.
    for (let i = 0; i < parsed.rows.length; i++) {
      const r = parsed.rows[i],
        v = r.values,
        code = text(v.code);
      if (r.entity === 'backlog') continue;
      if (r.entity === 'module') {
        const value = await tx.projectModule.upsert({
          where: { projectId_code: { projectId: project.id, code } },
          create: { projectId: project.id, code, name: text(v.name), description: fields(v, 'description') },
          update: { name: fields(v, 'name') ?? undefined, description: fields(v, 'description') },
        });
        ids.set(i, value.id);
        mods.set(code, value.id);
      } else {
        const last = await tx.requirement.findFirst({
          where: { projectId: project.id, kind: r.entity, deletedAt: null },
          orderBy: { rank: 'desc' },
        });
        const value = await tx.requirement.upsert({
          where: { projectId_code: { projectId: project.id, code } },
          create: {
            projectId: project.id,
            kind: r.entity,
            code,
            name: text(v.name),
            rank: rankBetween(last?.rank ?? null, null),
            traceRef: fields(v, 'traceRef'),
          },
          update: { name: fields(v, 'name') ?? undefined, traceRef: fields(v, 'traceRef') },
        });
        ids.set(i, value.id);
        reqs.set(code, value);
      }
    }
    for (let i = 0; i < parsed.rows.length; i++) {
      const r = parsed.rows[i],
        v = r.values,
        id = ids.get(i);
      if (!id || r.entity === 'module') continue;
      if (r.entity === 'function') {
        if (supplied(v.moduleCode))
          await tx.requirement.update({
            where: { id },
            data: { moduleId: clear(v.moduleCode) ? null : mods.get(text(v.moduleCode))! },
          });
        if (supplied(v.sources)) {
          await tx.requirementSource.deleteMany({ where: { requirementId: id } });
          const paths = clear(v.sources) ? [] : text(v.sources).split(/\r?\n/).map(text).filter(Boolean);
          if (paths.length)
            await tx.requirementSource.createMany({
              data: paths.map((path, position) => ({ requirementId: id, path, position })),
            });
        }
        if (supplied(v.epicCodes)) {
          const prior = await tx.requirementLink.findMany({
            where: { functionId: id },
            include: { epic: true },
          });
          for (const link of prior) if (link.epic.epicIssueId) changedEpicIds.add(link.epic.epicIssueId);
          await tx.requirementLink.deleteMany({ where: { functionId: id } });
          const epics = list(v.epicCodes);
          for (const code of epics)
            if (reqs.get(code)?.epicIssueId) changedEpicIds.add(reqs.get(code)!.epicIssueId!);
          if (epics.length)
            await tx.requirementLink.createMany({
              data: epics.map((c) => ({ functionId: id, epicId: reqs.get(c)!.id })),
            });
        }
      } else {
        const req = reqs.get(text(v.code))!;
        if (supplied(v.moduleCodes) || supplied(v.functionCodes)) changedEpicIds.add(req.epicIssueId!);
        await syncIssueStructure(
          tx,
          req.epicIssueId!,
          project.id,
          supplied(v.moduleCodes) ? list(v.moduleCodes).map((c) => Number(mods.get(c))) : undefined,
          supplied(v.functionCodes) ? list(v.functionCodes).map((c) => Number(reqs.get(c)!.id)) : undefined,
        );
      }
    }
    if (changedEpicIds.size)
      await tx.issue.updateMany({
        where: { id: { in: [...changedEpicIds] } },
        data: { version: { increment: 1 }, updatedAt: new Date() },
      });
    // Create all items without parents first, permitting forward workbook refs.
    const localRefs = new Map<string, bigint>();
    const output = preview.rows.map((r) => ({
      sheet: r.sheet,
      row: r.row,
      entity: r.entity,
      code: r.code,
      action: r.action,
      itemKey: undefined as string | undefined,
    }));
    for (let i = 0; i < parsed.rows.length; i++) {
      const r = parsed.rows[i],
        v = r.values;
      if (r.entity !== 'backlog') continue;
      const old = issueKeys.get(text(v.itemKey));
      const type = old?.type || text(v.type).toLowerCase() || 'task';
      const status = supplied(v.status)
        ? await tx.workflowStatus.findUniqueOrThrow({
            where: { projectId_name: { projectId: project.id, name: text(v.status) } },
          })
        : null;
      const assignee =
        supplied(v.assignee) && !clear(v.assignee)
          ? await tx.user.findUniqueOrThrow({ where: { email: text(v.assignee) } })
          : null;
      const period =
        supplied(v.period) && !clear(v.period)
          ? await tx.sprint.findFirstOrThrow({
              where: {
                projectId: project.id,
                name: text(v.period),
                kind: project.trackingMode,
                deletedAt: null,
                state: { not: 'closed' },
              },
            })
          : null;
      const from = old ? await tx.workflowStatus.findUniqueOrThrow({ where: { id: old.statusId } }) : null;
      const changedStatus = !!status && status.id !== old?.statusId;
      const data = {
        title: fields(v, 'title') ?? undefined,
        description: supplied(v.description)
          ? clear(v.description)
            ? Prisma.DbNull
            : doc(text(v.description))
          : undefined,
        priority: fields(v, 'priority') ?? undefined,
        statusId: status?.id,
        assigneeId: supplied(v.assignee) ? (assignee?.id ?? null) : undefined,
        sprintId: supplied(v.period) ? (period?.id ?? null) : undefined,
        estimateMinutes: supplied(v.estimateMinutes)
          ? clear(v.estimateMinutes)
            ? null
            : Number(v.estimateMinutes)
          : undefined,
        dueDate: supplied(v.dueDate) ? (clear(v.dueDate) ? null : new Date(text(v.dueDate))) : undefined,
        resolvedAt: changedStatus
          ? status.category === 'done'
            ? new Date()
            : from?.category === 'done'
              ? null
              : undefined
          : undefined,
        resolution: changedStatus
          ? status.category === 'done'
            ? 'done'
            : from?.category === 'done'
              ? null
              : undefined
          : undefined,
      };
      const value = old
        ? await tx.issue.update({ where: { id: old.id }, data: { ...data, version: { increment: 1 } } })
        : await tx.issue.create({
            data: {
              ...data,
              projectId: project.id,
              number: await allocateIssueNumber(tx, project.id),
              type,
              title: text(v.title),
              statusId: status?.id ?? settings.initialManualStatusId,
              reporterId: actorId,
              rank: await rankAtEnd(tx, project.id, period?.id ?? null),
            },
          });
      ids.set(i, value.id);
      const key = `${project.key}-${value.number}`;
      issueKeys.set(key, value);
      if (supplied(v.ref)) localRefs.set(text(v.ref), value.id);
      output[i].itemKey = key;
      if (!old) {
        const label = await tx.label.findUnique({
          where: { projectId_name: { projectId: project.id, name: 'manual' } },
        });
        if (label) await tx.issueLabel.create({ data: { issueId: value.id, labelId: label.id } });
      }
      if (!old || old.statusId !== value.statusId)
        await tx.issueStatusChange.create({
          data: {
            issueId: value.id,
            fromStatusId: old?.statusId,
            toStatusId: value.statusId,
            changedBy: actorId,
          },
        });
    }
    for (let i = 0; i < parsed.rows.length; i++) {
      const r = parsed.rows[i],
        v = r.values;
      if (r.entity !== 'backlog') continue;
      const id = ids.get(i)!;
      if (supplied(v.parent) || supplied(v.epicCode)) {
        let parentId: bigint | null | undefined;
        if (supplied(v.parent))
          parentId = clear(v.parent)
            ? null
            : (localRefs.get(text(v.parent)) ?? issueKeys.get(text(v.parent))!.id);
        else if (supplied(v.epicCode))
          parentId = clear(v.epicCode) ? null : reqs.get(text(v.epicCode))!.epicIssueId!;
        await tx.issue.update({ where: { id }, data: { parentId } });
      }
      await syncIssueStructure(
        tx,
        id,
        project.id,
        supplied(v.moduleCodes) ? list(v.moduleCodes).map((c) => Number(mods.get(c))) : undefined,
        supplied(v.functionCodes) ? list(v.functionCodes).map((c) => Number(reqs.get(c)!.id)) : undefined,
      );
    }
    for (let i = 0; i < parsed.rows.length; i++)
      await tx.activityLog.create({
        data: {
          projectId: project.id,
          entity:
            parsed.rows[i].entity === 'backlog'
              ? 'issue'
              : parsed.rows[i].entity === 'module'
                ? 'module'
                : 'requirement',
          entityId: String(ids.get(i)),
          action: preview.rows[i].action === 'create' ? 'created' : 'updated',
          actorId,
          changes: { import: true },
        },
      });
    return { counts: preview.counts, rows: output };
  }
}
