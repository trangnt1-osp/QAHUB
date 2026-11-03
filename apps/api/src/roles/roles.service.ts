import { Injectable } from '@nestjs/common';
import { BUILTIN_ROLE_PERMISSIONS, normalizePermissions, RoleDefinitionRow } from '@ospm/shared';
import { Prisma, RoleDefinition } from '@prisma/client';
import { badRequest, conflict, notFound } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { CreateRoleDto, UpdateBuiltinRoleDto, UpdateRoleDto } from './roles.dto';
import { BUILTIN_NAMES, BUILTIN_ROLES, isBuiltinRole } from './builtin-roles';

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<RoleDefinitionRow[]> {
    const { definitions, legacyCounts } = await this.prisma.$transaction(async (tx) => {
      const definitions = await tx.roleDefinition.findMany({ orderBy: [{ name: 'asc' }, { id: 'asc' }], include: { _count: { select: { members: true } } } });
      const legacyCounts = await tx.projectMember.groupBy({ by: ['role'], orderBy: { role: 'asc' }, where: { roleId: null }, _count: { _all: true } });
      return { definitions, legacyCounts };
    });
    return [
      ...BUILTIN_ROLES.map((key) => ({
        id: null, key, name: BUILTIN_NAMES[key], description: null, permissions: normalizePermissions(definitions.find((row) => row.key === key)?.permissions ?? BUILTIN_ROLE_PERMISSIONS[key]),
        builtin: true, memberCount: legacyCounts.find((row) => row.role === key)?._count._all ?? 0,
      })),
      ...definitions.filter((row) => !isBuiltinRole(row.key)).map((row) => this.row(row, row._count.members)),
    ];
  }

  async updateBuiltin(key: string, dto: UpdateBuiltinRoleDto): Promise<RoleDefinitionRow> {
    if (!isBuiltinRole(key)) throw notFound('ROLE_NOT_FOUND', 'Không tìm thấy vai trò mặc định.');
    if (dto.key !== undefined || dto.name !== undefined || dto.description !== undefined || dto.permissions === undefined) {
      throw badRequest('VALIDATION_ERROR', 'Chỉ được chỉnh sửa quyền của vai trò mặc định.');
    }
    const permissions = normalizePermissions(dto.permissions);
    await this.prisma.roleDefinition.upsert({ where: { key }, create: { key, name: BUILTIN_NAMES[key], permissions }, update: { permissions } });
    return { id: null, key, name: BUILTIN_NAMES[key], description: null, permissions, builtin: true,
      memberCount: await this.prisma.projectMember.count({ where: { role: key, roleId: null } }) };
  }

  async create(dto: CreateRoleDto): Promise<RoleDefinitionRow> {
    this.checkReserved(dto);
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.checkDuplicate(tx, dto);
        const role = await tx.roleDefinition.create({ data: { ...dto, permissions: normalizePermissions(dto.permissions) } });
        return this.row(role, 0);
      });
    } catch (error) { this.rethrowDuplicate(error); }
  }

  async update(id: bigint, dto: UpdateRoleDto): Promise<RoleDefinitionRow> {
    this.checkReserved(dto);
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lock(tx, id);
        await this.checkDuplicate(tx, dto, id);
        const role = await tx.roleDefinition.update({
          where: { id }, data: { ...dto, ...(dto.permissions !== undefined ? { permissions: normalizePermissions(dto.permissions) } : {}) },
          include: { _count: { select: { members: true } } },
        });
        return this.row(role, role._count.members);
      });
    } catch (error) { this.rethrowDuplicate(error); }
  }

  async remove(id: bigint): Promise<{ deleted: true }> {
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, id);
      if (await tx.projectMember.count({ where: { roleId: id } })) {
        throw conflict('ROLE_IN_USE', 'Không thể xóa vai trò đang được tham chiếu trong thành viên hiện tại hoặc lịch sử của dự án.');
      }
      await tx.roleDefinition.delete({ where: { id } });
      return { deleted: true };
    });
  }

  private row(role: RoleDefinition, memberCount: number): RoleDefinitionRow {
    return {
      id: Number(role.id), key: role.key, name: role.name, description: role.description,
      permissions: normalizePermissions(role.permissions), builtin: false, memberCount,
    };
  }

  private async lock(tx: Prisma.TransactionClient, id: bigint): Promise<void> {
    // Membership assignment takes this same lock before storing roleId.
    const rows = await tx.$queryRaw<{ id: bigint; key: string }[]>`SELECT id, key FROM role_definitions WHERE id = ${id} FOR UPDATE`;
    if (!rows.length) throw notFound('ROLE_NOT_FOUND', 'Không tìm thấy vai trò.');
    if (isBuiltinRole(rows[0].key)) throw conflict('ROLE_KEY_RESERVED', 'Vai trò mặc định chỉ được chỉnh sửa quyền và không thể xóa.');
  }

  private checkReserved(dto: UpdateRoleDto): void {
    if (dto.key && isBuiltinRole(dto.key)) {
      throw conflict('ROLE_KEY_RESERVED', 'Mã vai trò mặc định được dành riêng và không thể thay đổi.');
    }
    if (dto.name && Object.values(BUILTIN_NAMES).some((name) => name.toLowerCase() === dto.name!.toLowerCase())) {
      throw conflict('ROLE_NAME_TAKEN', 'Tên này đã được sử dụng bởi một vai trò mặc định.');
    }
  }

  private async checkDuplicate(tx: Prisma.TransactionClient, dto: UpdateRoleDto, id?: bigint): Promise<void> {
    const conditions: Prisma.RoleDefinitionWhereInput[] = [];
    if (dto.key !== undefined) conditions.push({ key: dto.key });
    if (dto.name !== undefined) conditions.push({ name: { equals: dto.name, mode: 'insensitive' } });
    if (!conditions.length) return;
    const duplicate = await tx.roleDefinition.findFirst({ where: { ...(id !== undefined ? { id: { not: id } } : {}), OR: conditions } });
    if (duplicate) throw conflict('ROLE_DUPLICATE', 'Đã tồn tại vai trò có mã hoặc tên này.');
  }

  private rethrowDuplicate(error: unknown): never {
    if ((error as { code?: string })?.code === 'P2002') throw conflict('ROLE_DUPLICATE', 'Đã tồn tại vai trò có mã hoặc tên này.');
    throw error;
  }
}
