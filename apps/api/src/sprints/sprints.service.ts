import { Injectable } from '@nestjs/common';
import { ERROR_CODES, rankBetween } from '@ospm/shared';
import { ActivityService } from '../activity/activity.service';
import { parseId } from '../common/bigint';
import { AppException, notFound, unprocessable } from '../common/errors';
import { PrismaService, Tx } from '../common/prisma.service';
import { rankAtEnd } from '../issues/issue-core';
import { CompleteSprintDto, CreateSprintDto, StartSprintDto, UpdateSprintDto } from './sprints.dto';

const dateValue = (value: string | null | undefined) => value === undefined ? undefined : value ? new Date(value) : null;
function validateDates(start?: Date | null, end?: Date | null) {
  if (start && end && end < start) throw unprocessable(ERROR_CODES.VALIDATION_ERROR, 'Ngày kết thúc không được trước ngày bắt đầu');
}

@Injectable()
export class SprintsService {
  constructor(private readonly prisma: PrismaService, private readonly activity: ActivityService) {}

  private async lockedPeriod(tx: Tx, id: bigint) {
    const original = await tx.sprint.findUnique({ where: { id } });
    if (!original) throw notFound(ERROR_CODES.SPRINT_NOT_FOUND, 'Không tìm thấy sprint/phase');
    // Same project lock as allocation validation and tracking-mode changes.
    await tx.$queryRaw`SELECT id FROM projects WHERE id = ${original.projectId} FOR UPDATE`;
    const period = await tx.sprint.findFirst({ where: { id, deletedAt: null }, include: { project: true } });
    if (!period) throw notFound(ERROR_CODES.SPRINT_NOT_FOUND, 'Không tìm thấy sprint/phase');
    if (period.kind !== period.project.trackingMode) throw unprocessable(ERROR_CODES.VALIDATION_ERROR, 'Sprint/phase không thuộc cách theo dõi hiện tại');
    return period;
  }

  async list(projectId: bigint) {
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    const rows = await this.prisma.sprint.findMany({ where: { projectId, kind: project.trackingMode, deletedAt: null }, orderBy: [{ position: 'asc' }, { id: 'asc' }], include: { _count: { select: { issues: true } } } });
    const [done, open] = await Promise.all([
      this.prisma.issue.groupBy({ by: ['sprintId'], where: { projectId, sprintId: { not: null }, deletedAt: null, status: { category: 'done' } }, _count: true }),
      this.prisma.issue.groupBy({ by: ['sprintId'], where: { projectId, sprintId: { not: null }, deletedAt: null, status: { category: { not: 'done' } } }, _count: true }),
    ]);
    const doneBy = new Map(done.map((row) => [row.sprintId, row._count]));
    const openBy = new Map(open.map((row) => [row.sprintId, row._count]));
    return rows.map(({ _count, ...row }) => ({ ...row, issueCount: _count.issues, doneCount: doneBy.get(row.id) ?? 0, openCount: openBy.get(row.id) ?? 0 }));
  }

  async create(projectId: bigint, projectKey: string, dto: CreateSprintDto, actorId: bigint) {
    validateDates(dateValue(dto.startDate), dateValue(dto.endDate));
    if (dto.name !== undefined && (typeof dto.name !== 'string' || !dto.name.trim())) throw unprocessable(ERROR_CODES.VALIDATION_ERROR, 'Tên không được để trống');
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM projects WHERE id = ${projectId} FOR UPDATE`;
      const project = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
      const kind = project.trackingMode;
      const n = (await tx.sprint.count({ where: { projectId, kind } })) + 1;
      const first = await tx.sprint.findFirst({ where: { projectId, deletedAt: null }, orderBy: { position: 'asc' } });
      const period = await tx.sprint.create({ data: { projectId, kind, name: dto.name?.trim() || `${projectKey} ${kind === 'phase' ? 'Phase' : 'Sprint'} ${n}`, goal: dto.goal, startDate: dateValue(dto.startDate), endDate: dateValue(dto.endDate), position: (first?.position ?? 1) - 1 } });
      await this.activity.log({ projectId, entity: 'sprint', entityId: period.id, action: 'created', actorId, changes: { name: [null, period.name], kind } }, tx);
      return period;
    });
  }

  async update(id: bigint, dto: UpdateSprintDto, actorId: bigint) {
    if (dto.name !== undefined && (typeof dto.name !== 'string' || !dto.name.trim())) throw unprocessable(ERROR_CODES.VALIDATION_ERROR, 'Tên không được để trống');
    return this.prisma.$transaction(async (tx) => {
      const period = await this.lockedPeriod(tx, id);
      if (period.state === 'closed') throw unprocessable(ERROR_CODES.VALIDATION_ERROR, 'Sprint/phase đã hoàn thành');
      const startDate = dto.startDate === undefined ? period.startDate : dateValue(dto.startDate);
      const endDate = dto.endDate === undefined ? period.endDate : dateValue(dto.endDate);
      validateDates(startDate, endDate);
      const updated = await tx.sprint.update({ where: { id }, data: { name: dto.name?.trim(), goal: dto.goal, startDate, endDate } });
      await this.activity.log({ projectId: period.projectId, entity: 'sprint', entityId: id, action: 'updated', actorId, changes: dto as any }, tx);
      return updated;
    });
  }

  async start(id: bigint, dto: StartSprintDto, actorId: bigint) {
    validateDates(dateValue(dto.startDate), dateValue(dto.endDate));
    return this.prisma.$transaction(async (tx) => {
      const period = await this.lockedPeriod(tx, id);
      if (period.state !== 'future') throw unprocessable(ERROR_CODES.VALIDATION_ERROR, 'Chỉ bắt đầu được sprint/phase chưa thực hiện');
      if (period.kind === 'sprint') {
        const active = await tx.sprint.findFirst({ where: { projectId: period.projectId, kind: 'sprint', state: 'active', deletedAt: null } });
        if (active) throw new AppException(409, ERROR_CODES.SPRINT_ALREADY_ACTIVE, `Dự án đã có sprint đang chạy: ${active.name}`);
      }
      const updated = await tx.sprint.update({ where: { id }, data: { state: 'active', startDate: new Date(dto.startDate), endDate: new Date(dto.endDate), goal: dto.goal ?? period.goal } });
      await this.activity.log({ projectId: period.projectId, entity: 'sprint', entityId: id, action: 'started', actorId }, tx);
      return updated;
    });
  }

  async complete(id: bigint, dto: CompleteSprintDto, actorId: bigint) {
    return this.prisma.$transaction(async (tx) => {
      const period = await this.lockedPeriod(tx, id);
      if (period.state !== 'active') throw unprocessable(ERROR_CODES.SPRINT_NOT_ACTIVE, 'Sprint/phase không ở trạng thái đang thực hiện');
      const issues = await tx.issue.findMany({ where: { sprintId: id, deletedAt: null }, include: { status: true }, orderBy: { rank: 'asc' } });
      const open = issues.filter((issue) => issue.status.category !== 'done');
      if (period.kind === 'phase' && open.length) throw unprocessable(ERROR_CODES.VALIDATION_ERROR, `Phase còn ${open.length} item chưa hoàn thành. Hãy hoàn thành hoặc chuyển các item trước.`);
      let target: bigint | null = null;
      if (period.kind === 'sprint' && dto.moveOpenIssuesTo !== 'backlog') {
        target = parseId(dto.moveOpenIssuesTo, ERROR_CODES.SPRINT_NOT_FOUND);
        const dest = await tx.sprint.findFirst({ where: { id: target, projectId: period.projectId, kind: period.kind, deletedAt: null } });
        if (!dest || dest.state === 'closed' || dest.id === id) throw unprocessable(ERROR_CODES.VALIDATION_ERROR, 'Sprint đích không hợp lệ');
      }
      if (open.length) {
        let rank = await rankAtEnd(tx, period.projectId, target);
        for (const issue of open) {
          await tx.issue.update({ where: { id: issue.id }, data: { sprintId: target, rank, version: { increment: 1 } } });
          rank = rankBetween(rank, null);
        }
      }
      await tx.sprint.update({ where: { id }, data: { state: 'closed', completedAt: new Date() } });
      await this.activity.log({ projectId: period.projectId, entity: 'sprint', entityId: id, action: 'completed', actorId, changes: { done: issues.length - open.length, moved: open.length } }, tx);
      return { id, done: issues.length - open.length, open: open.length, movedTo: target ?? 'backlog' };
    });
  }

  async remove(id: bigint, actorId: bigint) {
    return this.prisma.$transaction(async (tx) => {
      const period = await this.lockedPeriod(tx, id);
      const count = await tx.issue.count({ where: { sprintId: id } });
      if (count) throw unprocessable(ERROR_CODES.VALIDATION_ERROR, `Không thể xóa vì còn ${count} item liên kết, kể cả item đã hoàn thành hoặc đã xóa. Hãy chuyển item trước.`);
      if (period.state === 'active') throw unprocessable(ERROR_CODES.VALIDATION_ERROR, 'Hãy hoàn thành sprint/phase trước khi xóa');
      await tx.sprint.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.activity.log({ projectId: period.projectId, entity: 'sprint', entityId: id, action: 'deleted', actorId }, tx);
    });
  }
}
