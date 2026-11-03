import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { BUILTIN_ROLE_PERMISSIONS, ERROR_CODES, normalizePermissions, type ProjectRole } from '@ospm/shared';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { REFRESH_TOKEN_TTL_DAYS } from '../common/config';
import { AppException } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { builtinPermissionMap } from '../roles/builtin-roles';

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function publicUser(u: { id: bigint; email: string; displayName: string; avatarUrl: string | null; systemRole: string; isActive: boolean; lastLoginAt?: Date | null }) {
  return { id: u.id, email: u.email, displayName: u.displayName, avatarUrl: u.avatarUrl, systemRole: u.systemRole, isActive: u.isActive, lastLoginAt: u.lastLoginAt ?? null };
}

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService, private readonly jwt: JwtService) {}

  private signAccess(user: { id: bigint; systemRole: string }) {
    return this.jwt.sign({ sub: user.id.toString(), role: user.systemRole });
  }

  private async issueRefresh(userId: bigint) {
    const token = randomBytes(48).toString('base64url');
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 86400_000);
    await this.prisma.refreshToken.create({ data: { userId, tokenHash: sha256(token), expiresAt } });
    return { token, expiresAt };
  }

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    const ok = user && (await argon2.verify(user.passwordHash, password).catch(() => false));
    if (!user || !ok) throw new AppException(401, ERROR_CODES.INVALID_CREDENTIALS, 'Email hoặc mật khẩu không đúng');
    if (!user.isActive) throw new AppException(403, ERROR_CODES.USER_INACTIVE, 'Tài khoản đã bị khóa');
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const refresh = await this.issueRefresh(user.id);
    return { accessToken: this.signAccess(user), user: publicUser(user), refresh };
  }

  /** Xoay vòng refresh token: token cũ bị thu hồi, trả token mới. */
  async refresh(token?: string) {
    if (!token) throw new AppException(401, ERROR_CODES.UNAUTHORIZED, 'Thiếu refresh token');
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
    if (!row || row.revokedAt || row.expiresAt < new Date() || !row.user.isActive) {
      throw new AppException(401, ERROR_CODES.UNAUTHORIZED, 'Refresh token không hợp lệ');
    }
    await this.prisma.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
    const refresh = await this.issueRefresh(row.userId);
    return { accessToken: this.signAccess(row.user), user: publicUser(row.user), refresh };
  }

  async logout(token?: string) {
    if (!token) return;
    await this.prisma.refreshToken.updateMany({ where: { tokenHash: sha256(token), revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async me(userId: bigint) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const builtins = user.systemRole === 'admin' ? BUILTIN_ROLE_PERMISSIONS : await builtinPermissionMap(this.prisma);
    const projects =
      user.systemRole === 'admin'
        ? (await this.prisma.project.findMany({ where: { deletedAt: null }, orderBy: { key: 'asc' } })).map((p) => ({ projectId: p.id, projectKey: p.key, projectName: p.name, role: 'admin', roleId: null, roleName: 'Admin', permissions: BUILTIN_ROLE_PERMISSIONS.admin }))
        : (
            await this.prisma.projectMember.findMany({ where: { userId, leftAt: null, project: { deletedAt: null } }, include: { project: true, roleDefinition: true }, orderBy: { project: { key: 'asc' } } })
          ).map((m) => ({ projectId: m.projectId, projectKey: m.project.key, projectName: m.project.name, role: m.role, roleId: m.roleId, roleName: m.roleDefinition?.name ?? m.role,
            permissions: m.roleId ? normalizePermissions(m.roleDefinition?.permissions ?? []) : builtins[m.role as ProjectRole] ?? [] }));
    return { user: publicUser(user), projects };
  }

  async changePassword(userId: bigint, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await argon2.verify(user.passwordHash, currentPassword).catch(() => false))) {
      throw new AppException(400, ERROR_CODES.INVALID_CREDENTIALS, 'Mật khẩu hiện tại không đúng');
    }
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await argon2.hash(newPassword) } }),
      this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    return { ok: true };
  }
}
