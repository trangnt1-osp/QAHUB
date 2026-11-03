import { Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@ospm/shared';
import { PrismaService, Tx } from '../common/prisma.service';
import { badRequest, conflict, notFound, unprocessable } from '../common/errors';
import { CreateEnvironmentDto, UpdateEnvironmentDto } from './environments.dto';

const include = { owner: { select: { id: true, displayName: true, avatarUrl: true } } } as const;
@Injectable()
export class EnvironmentsService {
  constructor(private readonly prisma: PrismaService) {}
  list(projectId: bigint) {
    return this.prisma.projectEnvironment.findMany({ where: { projectId, deletedAt: null }, include, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  }
  ownerOptions(projectId: bigint) {
    return this.prisma.projectMember.findMany({ where: { projectId, leftAt: null, user: { isActive: true } }, select: { user: include.owner }, orderBy: { id: 'asc' } })
      .then(rows => rows.map(row => row.user));
  }
  private async fields(tx: Tx, projectId: bigint, dto: CreateEnvironmentDto | UpdateEnvironmentDto, previousOwnerId?: bigint | null) {
    const { version: _version, ownerId, ...data } = dto as UpdateEnvironmentDto;
    for (const key of ['appUrl', 'apiUrl'] as const) if (data[key]?.trim()) {
      try {
        const url = new URL(data[key]!.trim());
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
      } catch { throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'URL phải dùng http:// hoặc https:// và không chứa thông tin đăng nhập'); }
    }
    if (ownerId != null && BigInt(ownerId) !== previousOwnerId && !await tx.projectMember.findFirst({ where: { projectId, userId: BigInt(ownerId), leftAt: null, user: { isActive: true } } })) {
      throw unprocessable(ERROR_CODES.VALIDATION_ERROR, 'Người phụ trách phải là thành viên đang hoạt động của dự án');
    }
    for (const key of ['appUrl', 'apiUrl', 'deployedVersion', 'notes'] as const) if (data[key] !== undefined) data[key] = data[key]?.trim() || null;
    return { ...data, ...(ownerId !== undefined ? { ownerId: ownerId === null ? null : BigInt(ownerId) } : {}) };
  }
  async save(projectId: bigint, actorId: bigint, dto: CreateEnvironmentDto | UpdateEnvironmentDto, id?: bigint) {
    try {
      return await this.prisma.$transaction(async tx => {
        const current = id ? await tx.projectEnvironment.findFirst({ where: { id, projectId, deletedAt: null } }) : null;
        if (id && !current) throw notFound(ERROR_CODES.NOT_FOUND, 'Không tìm thấy môi trường');
        const data = await this.fields(tx, projectId, dto, current?.ownerId);
        let environmentId = id;
        if (id) {
          const updated = await tx.projectEnvironment.updateMany({ where: { id, projectId, deletedAt: null, version: (dto as UpdateEnvironmentDto).version }, data: { ...data, version: { increment: 1 } } });
          if (!updated.count) throw conflict(ERROR_CODES.VERSION_CONFLICT, 'Môi trường đã được thay đổi. Đóng form và mở lại để tải dữ liệu mới.');
        } else {
          const created = await tx.projectEnvironment.create({ data: { ...data, projectId, name: dto.name!, kind: dto.kind! } });
          environmentId = created.id;
        }
        await tx.activityLog.create({ data: { projectId, actorId, entity: 'environment', entityId: String(environmentId), action: id ? 'updated' : 'created', changes: { fields: Object.keys(dto).filter(key => key !== 'version') } } });
        return tx.projectEnvironment.findUniqueOrThrow({ where: { id: environmentId }, include });
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw conflict('ENVIRONMENT_NAME_TAKEN', 'Tên môi trường đã tồn tại trong dự án');
      throw error;
    }
  }
  async remove(projectId: bigint, actorId: bigint, id: bigint, version: number) {
    await this.prisma.$transaction(async tx => {
      if (!await tx.projectEnvironment.findFirst({ where: { id, projectId, deletedAt: null } })) throw notFound(ERROR_CODES.NOT_FOUND, 'Không tìm thấy môi trường');
      const updated = await tx.projectEnvironment.updateMany({ where: { id, projectId, deletedAt: null, version }, data: { deletedAt: new Date(), version: { increment: 1 } } });
      if (!updated.count) throw conflict(ERROR_CODES.VERSION_CONFLICT, 'Môi trường đã được thay đổi. Tải lại danh sách trước khi xóa.');
      await tx.activityLog.create({ data: { projectId, actorId, entity: 'environment', entityId: String(id), action: 'deleted', changes: {} } });
    });
  }
}
