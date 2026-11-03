import { Injectable } from '@nestjs/common';
import { ERROR_CODES, Permission, rankBetween } from '@ospm/shared';
import { ActivityService } from '../activity/activity.service';
import { AppException, forbidden, notFound, unprocessable } from '../common/errors';
import { PrismaService, Tx } from '../common/prisma.service';
import { CreateRequirementDto, UpdateRequirementDto } from './test-cases.dto';

export function progressOf(c: { total: number; passed: number; failed: number; na: number }): number {
  return c.total > 0 ? Math.round(((c.passed + c.failed) / c.total) * 1000) / 10 : 0;
}

@Injectable()
export class RequirementsService {
  constructor(private readonly prisma: PrismaService, private readonly activity: ActivityService) {}

  /** Cây Epic → Function kèm số test case và tóm tắt trạng thái. */
  async tree(projectId: bigint) {
    const [reqs, links, sources, counts] = await Promise.all([
      this.prisma.requirement.findMany({ where: { projectId, deletedAt: null }, orderBy: [{ rank: 'asc' }, { id: 'asc' }] }),
      this.prisma.requirementLink.findMany({ where: { epic: { projectId } } }),
      this.prisma.requirementSource.findMany({ where: { requirement: { projectId, deletedAt: null } }, orderBy: [{ position: 'asc' }, { id: 'asc' }] }),
      this.prisma.$queryRaw<{ function_id: bigint; status: string; n: bigint }[]>`
        SELECT function_id, status, count(*) n FROM test_cases WHERE project_id = ${projectId} AND deleted_at IS NULL GROUP BY 1, 2`,
    ]);
    const srcBy = new Map<bigint, string[]>();
    for (const s of sources) (srcBy.get(s.requirementId) ?? srcBy.set(s.requirementId, []).get(s.requirementId)!).push(s.path);
    const stat = new Map<bigint, { total: number; notStarted: number; passed: number; failed: number; blocked: number; na: number }>();
    for (const c of counts) {
      const s = stat.get(c.function_id) ?? stat.set(c.function_id, { total: 0, notStarted: 0, passed: 0, failed: 0, blocked: 0, na: 0 }).get(c.function_id)!;
      const n = Number(c.n);
      s.total += n;
      if (c.status === 'not_started') s.notStarted += n;
      else if (c.status === 'passed') s.passed += n;
      else if (c.status === 'failed') s.failed += n;
      else if (c.status === 'blocked') s.blocked += n;
      else if (c.status === 'na') s.na += n;
    }
    const fnById = new Map(reqs.filter((r) => r.kind === 'function').map((r) => [r.id, r]));
    const fnDto = (r: (typeof reqs)[number]) => {
      const st = stat.get(r.id) ?? { total: 0, notStarted: 0, passed: 0, failed: 0, blocked: 0, na: 0 };
      return { id: r.id, kind: r.kind, code: r.code, name: r.name, traceRef: r.traceRef, sources: srcBy.get(r.id) ?? [], rank: r.rank, counts: st, progress: progressOf(st) };
    };
    const linkedFns = new Set(links.map((l) => l.functionId));
    const epics = reqs.filter((r) => r.kind === 'epic').map((e) => {
      const functions = links.filter((l) => l.epicId === e.id).map((l) => fnById.get(l.functionId)).filter(Boolean).map((f) => fnDto(f!));
      const total = functions.reduce((a, f) => a + f.counts.total, 0);
      const passed = functions.reduce((a, f) => a + f.counts.passed, 0);
      const failed = functions.reduce((a, f) => a + f.counts.failed, 0);
      const na = functions.reduce((a, f) => a + f.counts.na, 0);
      return { id: e.id, kind: e.kind, code: e.code, name: e.name, traceRef: e.traceRef, sources: srcBy.get(e.id) ?? [], rank: e.rank, functions, counts: { total, passed, failed, na }, progress: progressOf({ total, passed, failed, na }) };
    });
    const unassigned = [...fnById.values()].filter((f) => !linkedFns.has(f.id)).map(fnDto);
    return { epics, unassigned };
  }

  private async setLinks(tx: Tx, req: { id: bigint; kind: string; projectId: bigint }, epicIds?: number[], functionIds?: number[]) {
    if (req.kind === 'function' && epicIds) {
      const epics = await tx.requirement.findMany({ where: { id: { in: epicIds.map(BigInt) }, projectId: req.projectId, kind: 'epic', deletedAt: null } });
      if (epics.length !== new Set(epicIds).size) throw unprocessable(ERROR_CODES.VALIDATION_ERROR, 'Epic không hợp lệ');
      await tx.requirementLink.deleteMany({ where: { functionId: req.id } });
      await tx.requirementLink.createMany({ data: epics.map((e) => ({ epicId: e.id, functionId: req.id })) });
    }
    if (req.kind === 'epic' && functionIds) {
      const fns = await tx.requirement.findMany({ where: { id: { in: functionIds.map(BigInt) }, projectId: req.projectId, kind: 'function', deletedAt: null } });
      if (fns.length !== new Set(functionIds).size) throw unprocessable(ERROR_CODES.VALIDATION_ERROR, 'Function không hợp lệ');
      await tx.requirementLink.deleteMany({ where: { epicId: req.id } });
      await tx.requirementLink.createMany({ data: fns.map((f) => ({ epicId: req.id, functionId: f.id })) });
    }
  }

  private async setSources(tx: Tx, requirementId: bigint, sources: string[]) {
    await tx.requirementSource.deleteMany({ where: { requirementId } });
    if (sources.length) await tx.requirementSource.createMany({ data: sources.map((path, position) => ({ requirementId, path, position })) });
  }

  async create(projectId: bigint, projectKey: string, dto: CreateRequirementDto, actorId: bigint) {
    if (await this.prisma.requirement.findUnique({ where: { projectId_code: { projectId, code: dto.code.trim() } } })) {
      throw new AppException(409, 'REQUIREMENT_CODE_TAKEN', `Mã ${dto.code} đã tồn tại`);
    }
    return this.prisma.$transaction(async (tx) => {
      const last = await tx.requirement.findFirst({ where: { projectId, kind: dto.kind, deletedAt: null }, orderBy: { rank: 'desc' } });
      const req = await tx.requirement.create({
        data: { projectId, kind: dto.kind, code: dto.code.trim(), name: dto.name.trim(), traceRef: dto.traceRef, rank: rankBetween(last?.rank ?? null, null) },
      });
      await this.setLinks(tx, req, dto.epicIds, dto.functionIds);
      if (dto.sources) await this.setSources(tx, req.id, dto.sources);
      await this.activity.log({ projectId, entity: 'requirement', entityId: req.id, action: 'created', actorId, changes: { code: [null, req.code] } }, tx);
      return req;
    });
  }

  async update(id: bigint, dto: UpdateRequirementDto, actorId: bigint) {
    return this.prisma.$transaction(async (tx) => {
      const req = await tx.requirement.findFirst({ where: { id, deletedAt: null } });
      if (!req) throw notFound(ERROR_CODES.REQUIREMENT_NOT_FOUND, 'Không tìm thấy epic/function');
      if (dto.code && dto.code !== req.code) {
        if (await tx.requirement.findUnique({ where: { projectId_code: { projectId: req.projectId, code: dto.code.trim() } } })) {
          throw new AppException(409, 'REQUIREMENT_CODE_TAKEN', `Mã ${dto.code} đã tồn tại`);
        }
      }
      const upd = await tx.requirement.update({ where: { id }, data: { code: dto.code?.trim(), name: dto.name?.trim(), traceRef: dto.traceRef } });
      await this.setLinks(tx, req, dto.epicIds, dto.functionIds);
      if (dto.sources) await this.setSources(tx, id, dto.sources);
      await this.activity.log({ projectId: req.projectId, entity: 'requirement', entityId: id, action: 'updated', actorId, changes: dto as any }, tx);
      return upd;
    });
  }

  /** Xóa mềm; xóa function thì xóa mềm cả test case của nó. */
  async remove(id: bigint, actorId: bigint, permissions?: Permission[]) {
    await this.prisma.$transaction(async (tx) => {
      const req = await tx.requirement.findFirst({ where: { id, deletedAt: null } });
      if (!req) throw notFound(ERROR_CODES.REQUIREMENT_NOT_FOUND, 'Không tìm thấy epic/function');
      if (req.kind === 'function' && permissions && !permissions.includes('testcase.delete') && await tx.testCase.count({ where: { functionId: id, deletedAt: null } })) {
        throw forbidden('Cần quyền xóa test case để xóa function còn chứa test case.');
      }
      const now = new Date();
      await tx.requirement.update({ where: { id }, data: { deletedAt: now } });
      if (req.kind === 'function') await tx.testCase.updateMany({ where: { functionId: id, deletedAt: null }, data: { deletedAt: now } });
      await this.activity.log({ projectId: req.projectId, entity: 'requirement', entityId: id, action: 'deleted', actorId }, tx);
    });
  }
}
