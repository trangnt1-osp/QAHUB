import { Injectable, OnModuleInit } from '@nestjs/common';
import { ERROR_CODES, rankBetween } from '@ospm/shared';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { ActivityService } from '../activity/activity.service';
import { parseId } from '../common/bigint';
import { AuthUser, ProjectContext } from '../common/decorators';
import { AppException, conflict, forbidden, notFound, unprocessable } from '../common/errors';
import { ProjectContextService } from '../common/project-context.service';
import { clampLimit, decodeCursor, encodeCursor } from '../common/pagination';
import { PrismaService, Tx } from '../common/prisma.service';
import { allocateIssueNumber, doc, findIssueByKey, rankAtEnd, recordStatusChange } from '../issues/issue-core';
import { JobsService } from '../jobs/jobs.service';
import { JOBS, QueueService } from '../queue/queue.service';
import { progressOf } from './requirements.service';
import {
  BulkTestCasesDto, CategoryDto, CreateTestCaseDto, LinkBugDto, ListTestCasesQuery, MoveTestCaseDto, TestCaseFilterQuery, UpdateCategoryDto, UpdateTestCaseDto,
} from './test-cases.dto';

const BULK_ASYNC_THRESHOLD = 1000;
const PRIORITY_ORDER = Prisma.raw(`array_position(ARRAY['critical','high','medium','low']::text[], tc.priority)`);
const STATUS_ORDER = Prisma.raw(`array_position(ARRAY['not_started','passed','failed','blocked','na']::text[], tc.status)`);

const SORTS: Record<string, { expr: Prisma.Sql; cast: string }> = {
  rank: { expr: Prisma.raw(`((f.rank || '/' || tc.rank) COLLATE "C")`), cast: 'text' },
  code: { expr: Prisma.raw(`((f.code || '/' || lpad(tc.seq::text, 8, '0')) COLLATE "C")`), cast: 'text' },
  priority: { expr: PRIORITY_ORDER, cast: 'int' },
  status: { expr: STATUS_ORDER, cast: 'int' },
  updatedAt: { expr: Prisma.raw('tc.updated_at'), cast: 'timestamptz' },
};

export type Step = { id: string; no: number; action: string; expected: string };

export function normalizeSteps(steps: { id?: string; action: string; expected: string }[] | undefined): Step[] {
  return (steps ?? []).map((s, i) => ({ id: s.id ?? randomUUID(), no: i + 1, action: s.action, expected: s.expected }));
}

const snapshotOf = (t: { title: string; priority: string; categoryId: bigint | null; preconditions: string | null; steps: unknown; status: string; notes: string | null; automationTag: string | null; functionId?: bigint }) => ({
  title: t.title, priority: t.priority, categoryId: t.categoryId, preconditions: t.preconditions, steps: t.steps, status: t.status, notes: t.notes, automationTag: t.automationTag, functionId: t.functionId,
});

export const formatCode = (functionCode: string, seq: number) => `CL_${functionCode}-${String(seq).padStart(3, '0')}`;

@Injectable()
export class TestCasesService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly queue: QueueService,
    private readonly jobs: JobsService,
    private readonly projectCtx: ProjectContextService,
  ) {}

  onModuleInit() {
    this.jobs.register(JOBS.TEST_CASES_BULK, (d) => this.runBulkJob(d));
  }

  // ---------- Truy vấn ----------

  private where(projectId: bigint, f: TestCaseFilterQuery): Prisma.Sql {
    const c: Prisma.Sql[] = [Prisma.sql`tc.project_id = ${projectId} AND tc.deleted_at IS NULL`];
    if (f.functionId) c.push(Prisma.sql`tc.function_id = ${parseId(f.functionId)}`);
    if (f.epicId) c.push(Prisma.sql`tc.function_id IN (SELECT function_id FROM requirement_links WHERE epic_id = ${parseId(f.epicId)})`);
    if (f.status?.length) c.push(Prisma.sql`tc.status = ANY(${f.status})`);
    if (f.priority?.length) c.push(Prisma.sql`tc.priority = ANY(${f.priority})`);
    if (f.categoryId?.length) c.push(Prisma.sql`tc.category_id = ANY(${f.categoryId.map((v) => parseId(v))})`);
    if (f.q?.trim()) {
      const q = f.q.trim();
      const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
      c.push(Prisma.sql`(tc.search_text @@ plainto_tsquery('simple', ${q}) OR tc.code ILIKE ${like} OR tc.title ILIKE ${like})`);
    }
    return Prisma.join(c, ' AND ');
  }

  /** Danh sách rút gọn (không có steps), cursor, limit tối đa 500. */
  async list(projectId: bigint, q: ListTestCasesQuery) {
    const limit = clampLimit(q.limit, 500, 100);
    const [field, dir] = (q.sort ?? 'rank').split(':');
    const sort = SORTS[field] ?? SORTS.rank;
    const desc = dir === 'desc';
    const cur = decodeCursor<{ v: string; id: string }>(q.cursor);
    const cmp = desc ? Prisma.raw('<') : Prisma.raw('>');
    const cursorSql = cur ? Prisma.sql`AND (${sort.expr}, tc.id) ${cmp} (${Prisma.sql`${cur.v}`}::${Prisma.raw(sort.cast)}${field === 'rank' || field === 'code' ? Prisma.raw(' COLLATE "C"') : Prisma.empty}, ${BigInt(cur.id)})` : Prisma.empty;
    const order = desc ? Prisma.raw('DESC') : Prisma.raw('ASC');
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT tc.id, tc.code, tc.seq, tc.function_id AS "functionId", f.code AS "functionCode", tc.title, tc.priority,
             tc.category_id AS "categoryId", c.name AS "categoryName", tc.preconditions, jsonb_array_length(tc.steps) AS "stepCount",
             tc.status, tc.notes, tc.automation_tag AS "automationTag", tc.version, tc.updated_at AS "updatedAt",
             CASE WHEN u.id IS NULL THEN NULL ELSE json_build_object('id', u.id, 'displayName', u.display_name, 'avatarUrl', u.avatar_url) END AS "updatedBy",
             COALESCE((SELECT json_agg(json_build_object('id', i.id, 'key', p.key || '-' || i.number) ORDER BY i.id)
                       FROM test_case_bugs b JOIN issues i ON i.id = b.issue_id JOIN projects p ON p.id = i.project_id
                       WHERE b.test_case_id = tc.id AND i.deleted_at IS NULL), '[]'::json) AS bugs,
             ${sort.expr}::text AS sort_key
      FROM test_cases tc
      JOIN requirements f ON f.id = tc.function_id
      LEFT JOIN test_categories c ON c.id = tc.category_id
      LEFT JOIN users u ON u.id = tc.updated_by
      WHERE ${this.where(projectId, q)} ${cursorSql}
      ORDER BY ${sort.expr} ${order}, tc.id ${order}
      LIMIT ${limit + 1}`;
    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map(({ sort_key: _s, ...r }) => r);
    const last = hasMore ? rows[limit - 1] : null;
    return { items, nextCursor: last ? encodeCursor({ v: last.sort_key, id: last.id.toString() }) : null };
  }

  /** Chỉ trả danh sách id khớp bộ lọc ("chọn tất cả"). */
  async ids(projectId: bigint, f: TestCaseFilterQuery) {
    const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`
      SELECT tc.id FROM test_cases tc JOIN requirements f ON f.id = tc.function_id
      WHERE ${this.where(projectId, f)} ORDER BY f.rank, tc.rank, tc.id LIMIT 100000`;
    return { ids: rows.map((r) => r.id), total: rows.length };
  }

  private async findOrThrow(id: bigint, db: Tx | PrismaService = this.prisma) {
    const tc = await db.testCase.findFirst({ where: { id, deletedAt: null }, include: { function: { select: { id: true, code: true, name: true } } } });
    if (!tc) throw notFound(ERROR_CODES.TEST_CASE_NOT_FOUND, 'Không tìm thấy test case');
    return tc;
  }

  async detail(id: bigint) {
    const tc = await this.findOrThrow(id);
    const [bugs, versions, category, updater] = await Promise.all([
      this.prisma.testCaseBug.findMany({ where: { testCaseId: id, issue: { deletedAt: null } }, include: { issue: { select: { id: true, number: true, title: true, project: { select: { key: true } }, status: { select: { name: true, color: true, category: true } } } } } }),
      this.prisma.testCaseVersion.findMany({ where: { testCaseId: id }, orderBy: { version: 'desc' }, take: 50, include: { user: { select: { id: true, displayName: true } } } }),
      tc.categoryId ? this.prisma.testCategory.findUnique({ where: { id: tc.categoryId } }) : null,
      tc.updatedBy ? this.prisma.user.findUnique({ where: { id: tc.updatedBy }, select: { id: true, displayName: true, avatarUrl: true } }) : null,
    ]);
    const { searchText: _s, ...rest } = tc as any;
    return {
      ...rest, category, updatedByUser: updater,
      bugs: bugs.map((b) => ({ id: b.issue.id, key: `${b.issue.project.key}-${b.issue.number}`, title: b.issue.title, status: b.issue.status })),
      versions: versions.map((v) => ({ version: v.version, snapshot: v.snapshot, changedAt: v.changedAt, changedBy: v.user })),
    };
  }

  // ---------- Ghi ----------

  private async assertCategory(tx: Tx, projectId: bigint, categoryId: number | null | undefined) {
    if (!categoryId) return;
    if (!(await tx.testCategory.findFirst({ where: { id: BigInt(categoryId), projectId } }))) throw unprocessable(ERROR_CODES.VALIDATION_ERROR, 'Category không thuộc dự án');
  }

  /** Cấp seq kế tiếp cho function; trả { seq, code } theo mẫu CL_{mã function}-{seq 3 chữ số}. */
  async allocateCode(tx: Tx, functionId: bigint) {
    const rows = await tx.$queryRaw<{ last_case_seq: number; code: string }[]>`UPDATE requirements SET last_case_seq = last_case_seq + 1 WHERE id = ${functionId} AND kind = 'function' AND deleted_at IS NULL RETURNING last_case_seq, code`;
    if (!rows.length) throw notFound(ERROR_CODES.REQUIREMENT_NOT_FOUND, 'Không tìm thấy function');
    return { seq: rows[0].last_case_seq, code: formatCode(rows[0].code, rows[0].last_case_seq), functionCode: rows[0].code };
  }

  async create(project: ProjectContext, dto: CreateTestCaseDto, user: AuthUser) {
    return this.prisma.$transaction(async (tx) => {
      const fn = await tx.requirement.findFirst({ where: { id: BigInt(dto.functionId), projectId: project.id, kind: 'function', deletedAt: null } });
      if (!fn) throw notFound(ERROR_CODES.REQUIREMENT_NOT_FOUND, 'Không tìm thấy function');
      await this.assertCategory(tx, project.id, dto.categoryId);
      const { seq, code } = await this.allocateCode(tx, fn.id);
      let prev: string | null = null;
      let next: string | null = null;
      if (dto.beforeId) {
        const b = await tx.testCase.findFirst({ where: { id: parseId(dto.beforeId), functionId: fn.id, deletedAt: null } });
        if (b) { next = b.rank; prev = (await tx.testCase.findFirst({ where: { functionId: fn.id, deletedAt: null, rank: { lt: b.rank } }, orderBy: { rank: 'desc' } }))?.rank ?? null; }
      }
      if (!next) prev = (await tx.testCase.findFirst({ where: { functionId: fn.id, deletedAt: null }, orderBy: { rank: 'desc' } }))?.rank ?? null;
      const tc = await tx.testCase.create({
        data: {
          projectId: project.id, functionId: fn.id, seq, code, title: dto.title.trim(), priority: dto.priority ?? 'medium', categoryId: dto.categoryId ? BigInt(dto.categoryId) : null,
          preconditions: dto.preconditions, steps: normalizeSteps(dto.steps) as any, status: dto.status ?? 'not_started', notes: dto.notes,
          automationTag: dto.automationTag ?? `@${code}`, rank: prev && next && prev >= next ? rankBetween(prev, null) : rankBetween(prev, next), createdBy: user.id, updatedBy: user.id,
        },
      });
      await tx.testCaseVersion.create({ data: { testCaseId: tc.id, version: 1, snapshot: snapshotOf(tc) as any, changedBy: user.id } });
      await this.activity.log({ projectId: project.id, entity: 'test_case', entityId: tc.id, action: 'created', actorId: user.id, changes: { code: [null, code] } }, tx);
      return tc;
    });
  }

  async update(id: bigint, dto: UpdateTestCaseDto, user: AuthUser) {
    return this.prisma.$transaction(async (tx) => {
      const tc = await this.findOrThrow(id, tx);
      if (tc.version !== dto.version) throw await this.versionConflict(tx, id);
      await this.assertCategory(tx, tc.projectId, dto.categoryId);
      const data: Prisma.TestCaseUncheckedUpdateManyInput = {};
      const changes: Record<string, [unknown, unknown]> = {};
      const set = (k: keyof Prisma.TestCaseUncheckedUpdateManyInput, from: unknown, to: unknown) => {
        if (JSON.stringify(from) === JSON.stringify(to)) return;
        (data as any)[k] = to;
        changes[k] = [from, to];
      };
      if (dto.title !== undefined) set('title', tc.title, dto.title.trim());
      if (dto.priority !== undefined) set('priority', tc.priority, dto.priority);
      if (dto.categoryId !== undefined) set('categoryId', tc.categoryId, dto.categoryId === null ? null : BigInt(dto.categoryId));
      if (dto.preconditions !== undefined) set('preconditions', tc.preconditions, dto.preconditions);
      if (dto.steps !== undefined) set('steps', tc.steps, normalizeSteps(dto.steps));
      if (dto.status !== undefined) set('status', tc.status, dto.status);
      if (dto.notes !== undefined) set('notes', tc.notes, dto.notes);
      if (dto.automationTag !== undefined) set('automationTag', tc.automationTag, dto.automationTag);
      if (!Object.keys(data).length) return tc;
      const upd = await tx.testCase.updateMany({ where: { id, version: dto.version }, data: { ...data, version: { increment: 1 }, updatedBy: user.id, updatedAt: new Date() } });
      if (upd.count === 0) throw await this.versionConflict(tx, id);
      const fresh = await tx.testCase.findUniqueOrThrow({ where: { id } });
      await tx.testCaseVersion.create({ data: { testCaseId: id, version: fresh.version, snapshot: snapshotOf(fresh) as any, changedBy: user.id } });
      await this.activity.log({ projectId: tc.projectId, entity: 'test_case', entityId: id, action: 'updated', actorId: user.id, changes: Object.fromEntries(Object.entries(changes).filter(([k]) => k !== 'steps')) }, tx);
      return fresh;
    });
  }

  /** 409 kèm người vừa sửa để giao diện báo "ai đã sửa trước". */
  private async versionConflict(tx: Tx, id: bigint) {
    const cur = await tx.testCase.findUnique({ where: { id }, include: { updater: { select: { id: true, displayName: true } } } });
    return conflict(ERROR_CODES.VERSION_CONFLICT, 'Test case vừa được người khác sửa', { currentVersion: cur?.version, updatedBy: cur?.updater, updatedAt: cur?.updatedAt });
  }

  async remove(id: bigint, user: AuthUser) {
    const tc = await this.findOrThrow(id);
    await this.prisma.testCase.update({ where: { id }, data: { deletedAt: new Date(), updatedBy: user.id } });
    await this.activity.log({ projectId: tc.projectId, entity: 'test_case', entityId: id, action: 'deleted', actorId: user.id });
  }

  async move(id: bigint, dto: MoveTestCaseDto, user: AuthUser) {
    return this.prisma.$transaction(async (tx) => {
      const tc = await this.findOrThrow(id, tx);
      const targetFnId = dto.functionId ? BigInt(dto.functionId) : tc.functionId;
      const data: Prisma.TestCaseUncheckedUpdateInput = {};
      if (targetFnId !== tc.functionId) {
        const fn = await tx.requirement.findFirst({ where: { id: targetFnId, projectId: tc.projectId, kind: 'function', deletedAt: null } });
        if (!fn) throw notFound(ERROR_CODES.REQUIREMENT_NOT_FOUND, 'Không tìm thấy function đích');
        // Giữ nguyên `code` (định danh ổn định, gắn với tag automation); chỉ cấp seq mới trong function đích
        data.functionId = targetFnId;
        data.seq = (await this.allocateCode(tx, targetFnId)).seq;
      }
      const siblings = { functionId: targetFnId, deletedAt: null, id: { not: id } } as const;
      let prev: string | null = null;
      let next: string | null = null;
      if (dto.afterId) {
        const a = await tx.testCase.findFirst({ where: { id: parseId(dto.afterId), functionId: targetFnId, deletedAt: null } });
        if (a) { prev = a.rank; next = (await tx.testCase.findFirst({ where: { ...siblings, rank: { gt: a.rank } }, orderBy: { rank: 'asc' } }))?.rank ?? null; }
      } else if (dto.beforeId) {
        const b = await tx.testCase.findFirst({ where: { id: parseId(dto.beforeId), functionId: targetFnId, deletedAt: null } });
        if (b) { next = b.rank; prev = (await tx.testCase.findFirst({ where: { ...siblings, rank: { lt: b.rank } }, orderBy: { rank: 'desc' } }))?.rank ?? null; }
      } else prev = (await tx.testCase.findFirst({ where: siblings, orderBy: { rank: 'desc' } }))?.rank ?? null;
      data.rank = prev && next && prev >= next ? rankBetween(prev, null) : rankBetween(prev, next);
      data.version = { increment: 1 };
      data.updatedBy = user.id;
      const upd = await tx.testCase.update({ where: { id }, data });
      await tx.testCaseVersion.create({ data: { testCaseId: id, version: upd.version, snapshot: snapshotOf(upd) as any, changedBy: user.id } });
      return upd;
    });
  }

  // ---------- Hàng loạt ----------

  private async resolveIds(projectId: bigint, dto: BulkTestCasesDto): Promise<bigint[]> {
    if (dto.ids?.length) {
      const ids = dto.ids.map((v) => parseId(v));
      const found = await this.prisma.testCase.count({ where: { id: { in: ids }, projectId, deletedAt: null } });
      if (found !== new Set(ids.map(String)).size) throw unprocessable(ERROR_CODES.VALIDATION_ERROR, 'Có test case không thuộc dự án');
      return ids;
    }
    if (dto.filter) return (await this.ids(projectId, dto.filter)).ids;
    throw unprocessable(ERROR_CODES.VALIDATION_ERROR, 'Cần ids hoặc filter');
  }

  async bulk(project: ProjectContext, dto: BulkTestCasesDto, user: AuthUser) {
    if (dto.set.deleted && !(project.permissions ? project.permissions.includes('testcase.delete') : ['tester', 'admin'].includes(project.role))) {
      throw new AppException(403, ERROR_CODES.FORBIDDEN, 'Chỉ tester và admin dự án được xóa test case');
    }
    const ids = await this.resolveIds(project.id, dto);
    if (!ids.length) return { updated: 0 };
    await this.assertCategory(this.prisma, project.id, dto.set.categoryId);
    if (ids.length > BULK_ASYNC_THRESHOLD) {
      const jobId = await this.queue.send(JOBS.TEST_CASES_BULK, { projectId: project.id.toString(), userId: user.id.toString(), ids: ids.map(String), set: dto.set });
      return { async: true, jobId, total: ids.length };
    }
    return { updated: await this.applyBulk(project.id, user.id, ids, dto.set) };
  }

  private async runBulkJob(d: { projectId: string; userId: string; ids: string[]; set: BulkTestCasesDto['set'] }) {
    const user = await this.prisma.user.findUnique({ where: { id: BigInt(d.userId) } });
    if (!user?.isActive) throw forbidden('Người thực hiện không còn hoạt động.');
    const project = await this.prisma.project.findFirst({ where: { id: BigInt(d.projectId), deletedAt: null }, select: { id: true } });
    if (!project) throw forbidden('Dự án không còn hoạt động.');
    await this.projectCtx.requirePermission(user, project.id, d.set.deleted ? 'testcase.delete' : 'testcase.edit');
    const updated = await this.applyBulk(BigInt(d.projectId), BigInt(d.userId), d.ids.map(BigInt), d.set);
    return { updated };
  }

  /** Cập nhật theo lô 1.000 dòng, mỗi lô một transaction. */
  async applyBulk(projectId: bigint, userId: bigint, ids: bigint[], set: BulkTestCasesDto['set']): Promise<number> {
    let total = 0;
    for (let i = 0; i < ids.length; i += 1000) {
      const chunk = ids.slice(i, i + 1000);
      total += await this.prisma.$transaction(async (tx) => {
        if (set.deleted) {
          const r = await tx.testCase.updateMany({ where: { id: { in: chunk }, projectId, deletedAt: null }, data: { deletedAt: new Date(), updatedBy: userId } });
          return r.count;
        }
        const data: Prisma.TestCaseUncheckedUpdateManyInput = {};
        if (set.status) data.status = set.status;
        if (set.priority) data.priority = set.priority;
        if (set.categoryId !== undefined) data.categoryId = set.categoryId === null ? null : BigInt(set.categoryId);
        let count = 0;
        if (Object.keys(data).length) {
          count = (await tx.testCase.updateMany({ where: { id: { in: chunk }, projectId, deletedAt: null }, data: { ...data, version: { increment: 1 }, updatedBy: userId, updatedAt: new Date() } })).count;
        }
        if (set.functionId) {
          const fnId = BigInt(set.functionId);
          if (!(await tx.requirement.findFirst({ where: { id: fnId, projectId, kind: 'function', deletedAt: null } }))) throw notFound(ERROR_CODES.REQUIREMENT_NOT_FOUND, 'Không tìm thấy function đích');
          let prev = (await tx.testCase.findFirst({ where: { functionId: fnId, deletedAt: null }, orderBy: { rank: 'desc' } }))?.rank ?? null;
          for (const id of chunk) {
            const { seq } = await this.allocateCode(tx, fnId);
            prev = rankBetween(prev, null);
            await tx.testCase.update({ where: { id }, data: { functionId: fnId, seq, rank: prev, version: { increment: 1 }, updatedBy: userId } });
            count++;
          }
        }
        // Ghi lịch sử phiên bản cho cả lô
        await tx.$executeRaw`
          INSERT INTO test_case_versions (test_case_id, version, snapshot, changed_by)
          SELECT id, version, jsonb_build_object('title', title, 'priority', priority, 'categoryId', category_id, 'preconditions', preconditions,
                 'steps', steps, 'status', status, 'notes', notes, 'automationTag', automation_tag, 'functionId', function_id), ${userId}
          FROM test_cases WHERE id = ANY(${chunk}) ON CONFLICT DO NOTHING`;
        return count;
      }, { timeout: 60_000 });
    }
    return total;
  }

  // ---------- Bug liên kết ----------

  async linkBug(id: bigint, dto: LinkBugDto, user: AuthUser, project: ProjectContext) {
    return this.prisma.$transaction(async (tx) => {
      const tc = await this.findOrThrow(id, tx);
      let issueId: bigint;
      let key: string;
      if (dto.issueKey) {
        const issue = await findIssueByKey(tx, dto.issueKey);
        if (issue.projectId !== tc.projectId) throw unprocessable(ERROR_CODES.VALIDATION_ERROR, 'Bug phải cùng dự án');
        issueId = issue.id;
        key = dto.issueKey;
      } else if (dto.createBug) {
        const settings = await tx.workflowSettings.findUniqueOrThrow({ where: { projectId: tc.projectId } });
        const manual = await tx.label.findUniqueOrThrow({ where: { projectId_name: { projectId: tc.projectId, name: 'manual' } } });
        const number = await allocateIssueNumber(tx, tc.projectId);
        const steps = (tc.steps as Step[]).map((s) => `${s.no}. ${s.action} → ${s.expected}`);
        const issue = await tx.issue.create({
          data: {
            projectId: tc.projectId, number, type: 'bug', title: (dto.title?.trim() || `[${tc.code}] ${tc.title}`).slice(0, 255),
            description: doc(`Test case: ${tc.code} — ${tc.title}`, ...(tc.preconditions ? [`Pre-conditions: ${tc.preconditions}`] : []), ...steps) as any,
            statusId: settings.initialManualStatusId, source: 'manual', reporterId: user.id, rank: await rankAtEnd(tx, tc.projectId, null), labels: { create: [{ labelId: manual.id }] },
          },
        });
        await recordStatusChange(tx, issue.id, null, issue.statusId, user.id);
        await this.activity.log({ projectId: tc.projectId, entity: 'issue', entityId: `${project.key}-${number}`, action: 'created', actorId: user.id, changes: { fromTestCase: [null, tc.code] } }, tx);
        issueId = issue.id;
        key = `${project.key}-${number}`;
        if (tc.status !== 'failed') {
          const upd = await tx.testCase.update({ where: { id }, data: { status: 'failed', version: { increment: 1 }, updatedBy: user.id } });
          await tx.testCaseVersion.create({ data: { testCaseId: id, version: upd.version, snapshot: snapshotOf(upd) as any, changedBy: user.id } });
        }
      } else throw unprocessable(ERROR_CODES.VALIDATION_ERROR, 'Cần issueKey hoặc createBug');
      await tx.testCaseBug.upsert({ where: { testCaseId_issueId: { testCaseId: id, issueId } }, update: {}, create: { testCaseId: id, issueId } });
      return { issueId, key };
    });
  }

  async unlinkBug(id: bigint, issueKey: string) {
    const tc = await this.findOrThrow(id);
    const issue = await findIssueByKey(this.prisma, issueKey);
    await this.prisma.testCaseBug.deleteMany({ where: { testCaseId: tc.id, issueId: issue.id } });
  }

  // ---------- Summary & category ----------

  async summary(projectId: bigint, f: { functionId?: string; epicId?: string }) {
    const rows = await this.prisma.$queryRaw<{ category_id: bigint | null; status: string; n: bigint }[]>`
      SELECT tc.category_id, tc.status, count(*) n FROM test_cases tc
      WHERE ${this.where(projectId, f)} GROUP BY 1, 2`;
    const cats = await this.prisma.testCategory.findMany({ where: { projectId }, orderBy: [{ position: 'asc' }, { id: 'asc' }] });
    const empty = () => ({ notStarted: 0, passed: 0, failed: 0, blocked: 0, na: 0, total: 0 });
    const key = (id: bigint | null) => (id === null ? 'none' : id.toString());
    const by = new Map<string, ReturnType<typeof empty>>([['none', empty()], ...cats.map((c) => [c.id.toString(), empty()] as const)]);
    const totals = empty();
    const field: Record<string, 'notStarted' | 'passed' | 'failed' | 'blocked' | 'na'> = { not_started: 'notStarted', passed: 'passed', failed: 'failed', blocked: 'blocked', na: 'na' };
    for (const r of rows) {
      const n = Number(r.n);
      const m = by.get(key(r.category_id)) ?? by.set(key(r.category_id), empty()).get(key(r.category_id))!;
      m[field[r.status]] += n; m.total += n;
      totals[field[r.status]] += n; totals.total += n;
    }
    const matrix = [...cats.map((c) => ({ categoryId: c.id, category: c.name, ...by.get(c.id.toString())! })), ...(by.get('none')!.total ? [{ categoryId: null, category: 'Uncategorized', ...by.get('none')! }] : [])];
    return { matrix, totals, progress: progressOf(totals) };
  }

  listCategories(projectId: bigint) {
    return this.prisma.testCategory.findMany({ where: { projectId }, orderBy: [{ position: 'asc' }, { id: 'asc' }] });
  }

  async createCategory(projectId: bigint, dto: CategoryDto) {
    const last = await this.prisma.testCategory.findFirst({ where: { projectId }, orderBy: { position: 'desc' } });
    return this.prisma.testCategory.create({ data: { projectId, name: dto.name.trim(), position: dto.position ?? (last?.position ?? 0) + 1 } });
  }

  async updateCategory(projectId: bigint, id: bigint, dto: UpdateCategoryDto) {
    if (!(await this.prisma.testCategory.findFirst({ where: { id, projectId } }))) throw notFound(ERROR_CODES.NOT_FOUND, 'Không tìm thấy category');
    return this.prisma.testCategory.update({ where: { id }, data: { name: dto.name?.trim(), position: dto.position } });
  }

  async deleteCategory(projectId: bigint, id: bigint) {
    if (!(await this.prisma.testCategory.findFirst({ where: { id, projectId } }))) throw notFound(ERROR_CODES.NOT_FOUND, 'Không tìm thấy category');
    await this.prisma.$transaction([
      this.prisma.testCase.updateMany({ where: { categoryId: id }, data: { categoryId: null } }),
      this.prisma.testCategory.delete({ where: { id } }),
    ]);
  }
}
