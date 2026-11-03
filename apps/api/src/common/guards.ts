import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { ERROR_CODES, Permission, PROJECT_ROLE_RANK, ProjectRole as ProjectRoleName } from '@ospm/shared';
import { IS_API_KEY, IS_PUBLIC, PROJECT_PERMISSION, PROJECT_ROLE, SYSTEM_ROLE } from './decorators';
import { ENDPOINT_PERMISSIONS, mutationPermissions } from './permission-policy';
import { AppException, forbidden } from './errors';
import { ProjectContextService } from './project-context.service';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }
  canActivate(ctx: ExecutionContext) {
    const skip = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    const apiKey = this.reflector.getAllAndOverride<boolean>(IS_API_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (skip || apiKey) return true;
    return super.canActivate(ctx);
  }
  handleRequest(err: any, user: any) {
    if (err || !user) throw new AppException(401, ERROR_CODES.UNAUTHORIZED, 'Chưa đăng nhập hoặc phiên đã hết hạn');
    return user;
  }
}

/** Kiểm tra @SystemRole và @ProjectRole; gắn `req.project` = { id, key, role }. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly projectCtx: ProjectContextService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    const sysRole = this.reflector.getAllAndOverride<string>(SYSTEM_ROLE, targets);
    const projRole = this.reflector.getAllAndOverride<{ role: ProjectRoleName; resolver: any }>(PROJECT_ROLE, targets);
    if (!sysRole && !projRole) return true;

    const req = ctx.switchToHttp().getRequest();
    const user = req.user;
    if (!user) throw new AppException(401, ERROR_CODES.UNAUTHORIZED, 'Chưa đăng nhập');

    if (sysRole && user.systemRole !== sysRole) throw forbidden('Chỉ quản trị hệ thống mới có quyền này');
    if (!projRole) return true;

    const project = await this.projectCtx.resolve(req.params, projRole.resolver);
    const access = await this.projectCtx.accessOf(user, project.id);
    if (!access) throw forbidden('Bạn không phải thành viên của dự án này');
    const endpoint = `${ctx.getClass().name}.${ctx.getHandler().name}`;
    const policy = this.reflector.getAllAndOverride<Permission[]>(PROJECT_PERMISSION, targets) ?? ENDPOINT_PERMISSIONS[endpoint];
    const required = typeof policy === 'string' ? [policy] : policy;
    if (user.systemRole !== 'admin') {
      if (required) {
        if (!required.some((permission) => access.permissions.includes(permission))) throw forbidden('Bạn không có quyền truy cập mục hoặc thao tác này');
      } else if (access.roleId || PROJECT_ROLE_RANK[access.role] < PROJECT_ROLE_RANK[projRole.role]) {
        throw forbidden('Bạn không có quyền thực hiện thao tác này');
      }
      if (!mutationPermissions(endpoint, req.body).every((permission) => access.permissions.includes(permission))) throw forbidden('Bạn không có quyền thực hiện một số thao tác trong yêu cầu');
    }
    req.project = { ...project, ...access };
    return true;
  }
}
