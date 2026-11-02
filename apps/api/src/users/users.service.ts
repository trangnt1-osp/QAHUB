import { Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@ospm/shared';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { AppException, forbidden, notFound } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { publicUser } from '../auth/auth.service';
import { CreateUserDto, ListUsersQuery, UpdateUserDto } from './users.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(q: ListUsersQuery) {
    const rows = await this.prisma.user.findMany({
      where: {
        ...(q.q ? { OR: [{ email: { contains: q.q, mode: 'insensitive' } }, { displayName: { contains: q.q, mode: 'insensitive' } }] } : {}),
        ...(q.status ? { isActive: q.status === 'active' } : {}),
      },
      orderBy: { displayName: 'asc' },
    });
    return rows.map(publicUser);
  }

  async create(dto: CreateUserDto) {
    const email = dto.email.toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new AppException(409, ERROR_CODES.EMAIL_TAKEN, 'Email đã được sử dụng');
    }
    const u = await this.prisma.user.create({
      data: { email, displayName: dto.displayName, systemRole: dto.systemRole, passwordHash: await argon2.hash(dto.password) },
    });
    return publicUser(u);
  }

  async update(id: bigint, dto: UpdateUserDto, actorId: bigint) {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) throw notFound(ERROR_CODES.USER_NOT_FOUND, 'Không tìm thấy người dùng');
    if (id === actorId && (dto.isActive === false || (dto.systemRole !== undefined && dto.systemRole !== existing.systemRole))) {
      throw forbidden('Không thể tự khóa hoặc thay đổi vai trò của chính mình');
    }
    try {
      const u = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.user.update({ where: { id }, data: dto });
        if (dto.isActive === false) {
          await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
        }
        return updated;
      });
      return publicUser(u);
    } catch (e: unknown) {
      if ((e as { code?: string })?.code === 'P2002') {
        throw new AppException(409, ERROR_CODES.EMAIL_TAKEN, 'Email đã được sử dụng');
      }
      throw e;
    }
  }

  async resetPassword(id: bigint) {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) throw notFound(ERROR_CODES.USER_NOT_FOUND, 'Không tìm thấy người dùng');
    const temporaryPassword = randomBytes(9).toString('base64url');
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id }, data: { passwordHash: await argon2.hash(temporaryPassword) } }),
      this.prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    return { temporaryPassword };
  }
}
