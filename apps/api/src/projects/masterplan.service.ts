import { Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@ospm/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { badRequest, conflict, notFound, unprocessable } from '../common/errors';
import { MasterplanFields, UpdateMasterplanDto } from './masterplan.dto';

const include = { owner: { select: { id: true, displayName: true, avatarUrl: true } }, featureLinks: { include: { feature: { select: { id: true, code: true, name: true } } }, orderBy: { featureId: 'asc' as const } } } as const;
type Milestone = Prisma.MasterplanMilestoneGetPayload<{ include: typeof include }>;
const present = ({ featureLinks, ...row }: Milestone) => ({ ...row, features: featureLinks.map(link => link.feature) });

@Injectable()
export class MasterplanService {
  constructor(private readonly prisma: PrismaService) {}
  async list(projectId: bigint) {
    const rows = await this.prisma.masterplanMilestone.findMany({ where: { projectId, deletedAt: null }, include, orderBy: [{ endDate: 'asc' }, { id: 'asc' }] });
    return rows.map(present);
  }
  async options(projectId: bigint) {
    const [members, features] = await Promise.all([
      this.prisma.projectMember.findMany({ where: { projectId, leftAt: null, user: { isActive: true } }, select: { user: { select: { id: true, displayName: true, avatarUrl: true } } } }),
      this.prisma.requirement.findMany({ where: { projectId, kind: 'function', deletedAt: null }, select: { id: true, code: true, name: true }, orderBy: { code: 'asc' } }),
    ]);
    return { owners: members.map(member => member.user), features };
  }
  async save(projectId: bigint, actorId: bigint, dto: MasterplanFields | UpdateMasterplanDto, id?: bigint) {
    return this.prisma.$transaction(async tx => {
      const current = id ? await tx.masterplanMilestone.findFirst({ where: { id, projectId, deletedAt: null }, include: { featureLinks: { select: { featureId: true } } } }) : null;
      if (id && !current) throw notFound(ERROR_CODES.NOT_FOUND, 'Không tìm thấy mốc kế hoạch');
      const { featureIds, ownerId, startDate, endDate, ...fields } = dto;
      const data: Prisma.MasterplanMilestoneUncheckedCreateInput = {
        projectId, name: fields.name,
        status: fields.status ?? current?.status ?? 'planned',
        progress: fields.progress ?? current?.progress ?? 0,
        acceptanceCriteria: fields.acceptanceCriteria === undefined ? current?.acceptanceCriteria : fields.acceptanceCriteria?.trim() || null,
        notes: fields.notes === undefined ? current?.notes : fields.notes?.trim() || null,
        startDate: startDate === undefined ? current?.startDate : startDate ? new Date(`${startDate}T00:00:00Z`) : null,
        endDate: endDate === undefined ? current?.endDate : endDate ? new Date(`${endDate}T00:00:00Z`) : null,
        ownerId: ownerId === undefined ? current?.ownerId : ownerId === null ? null : BigInt(ownerId),
      };
      if (data.status === 'completed') data.progress = 100;
      if (data.startDate && data.endDate && new Date(data.startDate) > new Date(data.endDate)) throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'Ngày kết thúc phải từ ngày bắt đầu trở đi');
      if (ownerId != null && BigInt(ownerId) !== current?.ownerId && !await tx.projectMember.findFirst({ where: { projectId, userId: BigInt(ownerId), leftAt: null, user: { isActive: true } } })) throw unprocessable(ERROR_CODES.VALIDATION_ERROR, 'Người phụ trách phải là thành viên đang hoạt động của dự án');
      if (featureIds !== undefined && await tx.requirement.count({ where: {
        id: { in: featureIds.map(BigInt) }, projectId, kind: 'function',
        OR: [{ deletedAt: null }, { id: { in: current?.featureLinks.map(link => link.featureId) ?? [] } }],
      } }) !== featureIds.length) throw unprocessable(ERROR_CODES.VALIDATION_ERROR, 'Tính năng mới phải thuộc dự án và chưa bị xóa');
      let milestoneId = id;
      if (id) {
        const updated = await tx.masterplanMilestone.updateMany({ where: { id, projectId, deletedAt: null, version: (dto as UpdateMasterplanDto).version }, data: { ...data, version: { increment: 1 } } });
        if (!updated.count) throw conflict(ERROR_CODES.VERSION_CONFLICT, 'Mốc kế hoạch đã thay đổi. Đóng form và mở lại để tải dữ liệu mới.');
      } else milestoneId = (await tx.masterplanMilestone.create({ data })).id;
      if (featureIds !== undefined) {
        await tx.masterplanFeature.deleteMany({ where: { milestoneId } });
        if (featureIds.length) await tx.masterplanFeature.createMany({ data: featureIds.map(featureId => ({ milestoneId: milestoneId!, featureId: BigInt(featureId) })) });
      }
      await tx.activityLog.create({ data: { projectId, actorId, entity: 'masterplan', entityId: String(milestoneId), action: id ? 'updated' : 'created', changes: { fields: Object.keys(dto).filter(key => key !== 'version') } } });
      return present(await tx.masterplanMilestone.findUniqueOrThrow({ where: { id: milestoneId }, include }));
    });
  }
  async remove(projectId: bigint, actorId: bigint, id: bigint, version: number) {
    await this.prisma.$transaction(async tx => {
      if (!await tx.masterplanMilestone.findFirst({ where: { id, projectId, deletedAt: null } })) throw notFound(ERROR_CODES.NOT_FOUND, 'Không tìm thấy mốc kế hoạch');
      const result = await tx.masterplanMilestone.updateMany({ where: { id, projectId, deletedAt: null, version }, data: { deletedAt: new Date(), version: { increment: 1 } } });
      if (!result.count) throw conflict(ERROR_CODES.VERSION_CONFLICT, 'Mốc kế hoạch đã thay đổi. Tải lại trước khi xóa.');
      await tx.activityLog.create({ data: { projectId, actorId, entity: 'masterplan', entityId: String(id), action: 'deleted', changes: {} } });
    });
  }
}
