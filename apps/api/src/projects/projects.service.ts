import { Injectable } from '@nestjs/common';
import { BUILTIN_ROLE_PERMISSIONS, ERROR_CODES, normalizePermissions, Permission, ProjectRole, SYSTEM_LABELS, WorkflowTemplateDefinition, DEFAULT_TEST_CATEGORIES } from '@ospm/shared';
import { ActivityService } from '../activity/activity.service';
import { AppException, badRequest, forbidden, notFound } from '../common/errors';
import { PrismaService, Tx } from '../common/prisma.service';
import { applyTemplateDefinition } from '../workflows/workflow-bootstrap';
import { AddMemberDto, CreateProjectDto, UpdateMemberDto, UpdateProjectDto, UpdateSettingsDto } from './projects.dto';
import type { AuthUser } from '../common/decorators';
import { builtinPermissionMap, builtinPermissions, isBuiltinRole } from '../roles/builtin-roles';

const LABEL_COLORS: Record<string, string> = { manual: '#8c8c8c', auto: '#722ed1' };
const projectDate = (value: string | null | undefined) => value === undefined ? undefined : value === null ? null : new Date(`${value}T00:00:00.000Z`);
const memberDay = (date: Date) => new Date(date.getTime() + 7 * 3600_000).toISOString().slice(0, 10);

function validateProjectDates(startDate: Date | null | undefined, endDate: Date | null | undefined) {
  if (startDate && endDate && endDate < startDate) {
    throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'Ngày kết thúc không được trước ngày bắt đầu');
  }
}

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService, private readonly activity: ActivityService) {}

  async list(user: AuthUser) {
    const builtins = user.systemRole === 'admin' ? BUILTIN_ROLE_PERMISSIONS : await builtinPermissionMap(this.prisma);
    const projects = await this.prisma.project.findMany({
      where: { deletedAt: null, ...(user.systemRole === 'admin' ? {} : { members: { some: { userId: user.id, leftAt: null } } }) },
      include: { lead: { select: { id: true, displayName: true, avatarUrl: true } }, members: { where: { userId: user.id, leftAt: null }, select: { role: true, roleId: true, roleDefinition: { select: { permissions: true } } } } },
      orderBy: { key: 'asc' },
    });
    const ids = projects.map((p) => p.id);
    const [open, pending, sprints] = await Promise.all([
      this.prisma.$queryRaw<{ project_id: bigint; n: bigint }[]>`
        SELECT i.project_id, count(*) n FROM issues i JOIN workflow_statuses s ON s.id = i.status_id
        WHERE i.deleted_at IS NULL AND s.category <> 'done' AND i.project_id = ANY(${ids}) GROUP BY i.project_id`,
      this.prisma.$queryRaw<{ project_id: bigint; n: bigint }[]>`
        SELECT i.project_id, count(*) n FROM issues i JOIN workflow_statuses s ON s.id = i.status_id
        WHERE i.deleted_at IS NULL AND s.category = 'triage' AND i.project_id = ANY(${ids}) GROUP BY i.project_id`,
      this.prisma.sprint.findMany({ where: { projectId: { in: ids }, state: 'active', deletedAt: null }, select: { projectId: true, id: true, name: true } }),
    ]);
    const openBy = new Map(open.map((r) => [r.project_id, Number(r.n)]));
    const pendBy = new Map(pending.map((r) => [r.project_id, Number(r.n)]));
    const sprintBy = new Map(sprints.map((s) => [s.projectId, s]));
    return projects.flatMap((p) => {
      const membership = p.members[0];
      const permissions = user.systemRole === 'admin' ? BUILTIN_ROLE_PERMISSIONS.admin : membership?.roleId ? normalizePermissions(membership.roleDefinition?.permissions ?? []) : builtins[membership?.role as ProjectRole] ?? [];
      if (!permissions.includes('project.view')) return [];
      const info = permissions.includes('project.info.view');
      const issues = permissions.includes('issue.view');
      return [{
      id: p.id, key: p.key, name: p.name, trackingMode: p.trackingMode, description: info ? p.description : undefined, lead: info ? p.lead : undefined, startDate: info ? p.startDate : undefined, endDate: info ? p.endDate : undefined, createdAt: info ? p.createdAt : undefined,
      myRole: user.systemRole === 'admin' ? 'admin' : p.members[0]?.role ?? null,
      openIssues: issues ? openBy.get(p.id) ?? 0 : undefined,
      pendingReview: issues ? pendBy.get(p.id) ?? 0 : undefined,
      activeSprint: permissions.includes('period.view') ? sprintBy.get(p.id) ?? null : undefined,
    }];
    });
  }

  async create(dto: CreateProjectDto, actor: AuthUser) {
    validateProjectDates(projectDate(dto.startDate), projectDate(dto.endDate));
    if (await this.prisma.project.findUnique({ where: { key: dto.key } })) {
      throw new AppException(409, ERROR_CODES.PROJECT_KEY_TAKEN, `Mã dự án ${dto.key} đã tồn tại`);
    }
    const tpl = await this.prisma.workflowTemplate.findUnique({ where: { id: BigInt(dto.workflowTemplateId) } });
    if (!tpl) throw notFound(ERROR_CODES.NOT_FOUND, 'Không tìm thấy workflow template');
    if (dto.leadId && !(await this.prisma.user.findUnique({ where: { id: BigInt(dto.leadId) } }))) {
      throw notFound(ERROR_CODES.USER_NOT_FOUND, 'Không tìm thấy lead');
    }
    return this.prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: { key: dto.key, name: dto.name, trackingMode: dto.trackingMode, description: dto.description, leadId: dto.leadId ? BigInt(dto.leadId) : null, startDate: projectDate(dto.startDate), endDate: projectDate(dto.endDate), settings: { createBugForFlaky: false } },
      });
      await applyTemplateDefinition(tx, project.id, tpl.definition as unknown as WorkflowTemplateDefinition);
      for (const name of SYSTEM_LABELS) {
        await tx.label.create({ data: { projectId: project.id, name, color: LABEL_COLORS[name], isSystem: true } });
      }
      await tx.testCategory.createMany({ data: DEFAULT_TEST_CATEGORIES.map((name, position) => ({ projectId: project.id, name, position })) });
      const adminIds = new Set<bigint>([actor.id]);
      if (dto.leadId) adminIds.add(BigInt(dto.leadId));
      await tx.projectMember.createMany({ data: [...adminIds].map((userId) => ({ projectId: project.id, userId, role: 'admin' })) });
      await this.activity.log({ projectId: project.id, entity: 'project', entityId: project.key, action: 'created', actorId: actor.id }, tx);
      return project;
    });
  }

  async get(projectId: bigint, role: string, permissions?: Permission[]) {
    const p = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: { lead: { select: { id: true, displayName: true, avatarUrl: true } } } });
    const info = !permissions || permissions.includes('project.info.view');
    const settings = !permissions || permissions.includes('settings.general.view');
    return { id: p.id, key: p.key, name: p.name, trackingMode: p.trackingMode, description: info ? p.description : undefined, lead: info ? p.lead : undefined, startDate: info ? p.startDate : undefined, endDate: info ? p.endDate : undefined, settings: settings ? p.settings : undefined, createdAt: info ? p.createdAt : undefined, myRole: role };
  }

  async update(projectId: bigint, dto: UpdateProjectDto, actorId: bigint) {
    if (dto.leadId !== undefined && dto.leadId !== null && !(await this.prisma.user.findUnique({ where: { id: BigInt(dto.leadId) } }))) {
      throw notFound(ERROR_CODES.USER_NOT_FOUND, 'Không tìm thấy lead');
    }
    return this.prisma.$transaction(async (tx) => {
      // Serialize edits so partial date updates validate against the latest saved counterpart.
      await tx.$queryRaw`SELECT id FROM projects WHERE id = ${projectId} FOR UPDATE`;
      const existing = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
      if (dto.trackingMode && dto.trackingMode !== existing.trackingMode) {
        const assigned = await tx.issue.count({ where: { projectId, sprintId: { not: null } } });
        const active = await tx.sprint.count({ where: { projectId, deletedAt: null, state: 'active' } });
        if (assigned || active) throw new AppException(409, ERROR_CODES.VALIDATION_ERROR, 'Không thể đổi cách theo dõi khi còn item được phân bổ hoặc sprint/phase đang thực hiện');
      }
      const startDate = dto.startDate === undefined ? existing.startDate : projectDate(dto.startDate);
      const endDate = dto.endDate === undefined ? existing.endDate : projectDate(dto.endDate);
      validateProjectDates(startDate, endDate);
      const p = await tx.project.update({
        where: { id: projectId },
        data: { name: dto.name, trackingMode: dto.trackingMode, description: dto.description, leadId: dto.leadId === undefined ? undefined : dto.leadId === null ? null : BigInt(dto.leadId), startDate, endDate },
      });
      await this.activity.log({ projectId, entity: 'project', entityId: p.key, action: 'updated', actorId, changes: dto as any }, tx);
      return p;
    });
  }

  async remove(projectId: bigint, actorId: bigint) {
    const p = await this.prisma.project.update({ where: { id: projectId }, data: { deletedAt: new Date() } });
    await this.activity.log({ projectId, entity: 'project', entityId: p.key, action: 'deleted', actorId });
  }

  async updateSettings(projectId: bigint, dto: UpdateSettingsDto, actorId: bigint) {
    const p = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    const settings = { ...(p.settings as object), ...dto };
    await this.prisma.project.update({ where: { id: projectId }, data: { settings } });
    await this.activity.log({ projectId, entity: 'project', entityId: p.key, action: 'settings_updated', actorId, changes: dto as any });
    return settings;
  }

  // ----- Thành viên -----
  memberOptions(projectId: bigint) {
    return this.prisma.projectMember.findMany({ where: { projectId, leftAt: null }, include: { user: { select: { id: true, displayName: true, avatarUrl: true } } }, orderBy: { id: 'asc' } })
      .then((rows) => rows.map((member) => ({ id: member.id, userId: member.userId, user: member.user })));
  }

  private async membershipRole(tx: Tx, dto: { role?: ProjectRole; roleId?: number }, actorPermissions?: Permission[]) {
    if ((dto.role === undefined) === (dto.roleId === undefined)) throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'Chọn đúng một vai trò có sẵn hoặc vai trò tùy chỉnh');
    let permissions: Permission[];
    let role: ProjectRole = dto.role ?? 'viewer';
    let roleId: bigint | null = null;
    if (dto.roleId !== undefined) {
      roleId = BigInt(dto.roleId);
      await tx.$queryRaw`SELECT id FROM role_definitions WHERE id = ${roleId} FOR UPDATE`;
      const definition = await tx.roleDefinition.findUnique({ where: { id: roleId } });
      if (!definition) throw notFound(ERROR_CODES.NOT_FOUND, 'Không tìm thấy vai trò');
      if (isBuiltinRole(definition.key)) throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'Chọn vai trò mặc định bằng mã vai trò.');
      permissions = normalizePermissions(definition.permissions);
      role = 'viewer';
    } else permissions = await builtinPermissions(tx, role);
    if (actorPermissions && !permissions.every((permission) => actorPermissions.includes(permission))) throw forbidden('Không thể gán vai trò có quyền vượt quá quyền của bạn');
    return { role, roleId };
  }

  listMembers(projectId: bigint, includeHistory = false) {
    return this.prisma.projectMember
      .findMany({ where: { projectId, ...(!includeHistory ? { leftAt: null } : {}) }, include: { roleDefinition: true, user: { select: { id: true, email: true, displayName: true, avatarUrl: true, isActive: true } } }, orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }] })
      .then((rows) => rows.map((m) => ({ id: m.id, userId: m.userId, role: m.role, roleId: m.roleId, roleName: m.roleDefinition?.name ?? m.role, joinedAt: m.joinedAt, leftAt: m.leftAt, user: m.user })));
  }

  async addMember(projectId: bigint, dto: AddMemberDto, actorPermissions?: Permission[]) {
    const userId = BigInt(dto.userId);
    if (!(await this.prisma.user.findUnique({ where: { id: userId } }))) throw notFound(ERROR_CODES.USER_NOT_FOUND, 'Không tìm thấy người dùng');
    const joinedAt = dto.joinedAt ? projectDate(dto.joinedAt)! : new Date();
    if (memberDay(joinedAt) > memberDay(new Date())) throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'Ngày tham gia không được ở tương lai');
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM projects WHERE id = ${projectId} FOR UPDATE`;
      const assignment = await this.membershipRole(tx, dto, actorPermissions);
      if (await tx.projectMember.findFirst({ where: { projectId, userId, leftAt: null } })) {
        throw new AppException(409, ERROR_CODES.MEMBER_EXISTS, 'Người dùng đã là thành viên dự án');
      }
      const previous = await tx.projectMember.findFirst({ where: { projectId, userId, leftAt: { not: null } }, orderBy: { leftAt: 'desc' } });
      if (previous?.leftAt && memberDay(joinedAt) < memberDay(previous.leftAt)) {
        throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'Ngày tham gia lại không được trước ngày rời lần trước');
      }
      return tx.projectMember.create({ data: { projectId, userId, ...assignment, joinedAt } });
    });
  }

  private async activeMember(tx: Tx, projectId: bigint, userId: bigint) {
    const member = await tx.projectMember.findFirst({ where: { projectId, userId, leftAt: null } });
    if (!member) throw notFound(ERROR_CODES.MEMBER_NOT_FOUND, 'Không tìm thấy thành viên');
    return member;
  }

  private async assertNotLastAdmin(tx: Tx, projectId: bigint, role: string) {
    if (role === 'admin' && (await tx.projectMember.count({ where: { projectId, role: 'admin', leftAt: null } })) <= 1) {
      throw new AppException(422, ERROR_CODES.WORKFLOW_INVALID, 'Dự án phải còn ít nhất một admin');
    }
  }

  async updateMember(projectId: bigint, userId: bigint, dto: UpdateMemberDto, actorPermissions?: Permission[]) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM projects WHERE id = ${projectId} FOR UPDATE`;
      const member = await this.activeMember(tx, projectId, userId);
      const assignment = await this.membershipRole(tx, dto, actorPermissions);
      if (assignment.role !== 'admin') await this.assertNotLastAdmin(tx, projectId, member.role);
      return tx.projectMember.update({ where: { id: member.id }, data: assignment });
    });
  }

  async removeMember(projectId: bigint, userId: bigint, date?: string) {
    const leftAt = date ? projectDate(date)! : new Date();
    if (memberDay(leftAt) > memberDay(new Date())) throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'Ngày rời dự án không được ở tương lai');
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM projects WHERE id = ${projectId} FOR UPDATE`;
      const member = await this.activeMember(tx, projectId, userId);
      await this.assertNotLastAdmin(tx, projectId, member.role);
      if (memberDay(leftAt) < memberDay(member.joinedAt)) throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'Ngày rời không được trước ngày tham gia');
      return tx.projectMember.update({ where: { id: member.id }, data: { leftAt } });
    });
  }
}
