import { BUILTIN_ROLE_PERMISSIONS, normalizePermissions, type Permission, type ProjectRole } from '@ospm/shared';
import type { Tx } from '../common/prisma.service';

export const BUILTIN_ROLES: ProjectRole[] = ['admin', 'developer', 'tester', 'viewer'];
export const BUILTIN_NAMES: Record<ProjectRole, string> = { admin: 'Admin', developer: 'Developer', tester: 'Tester', viewer: 'Viewer' };
export const isBuiltinRole = (key: string): key is ProjectRole => BUILTIN_ROLES.includes(key as ProjectRole);

/** Defaults remain compatible with old assignments; an explicit empty override revokes all grants. */
export async function builtinPermissions(db: Pick<Tx, 'roleDefinition'>, role: ProjectRole): Promise<Permission[]> {
  const override = await db.roleDefinition.findUnique({ where: { key: role }, select: { permissions: true } });
  return override ? normalizePermissions(override.permissions) : BUILTIN_ROLE_PERMISSIONS[role] ?? [];
}

/** Resolve once for endpoints returning many memberships, without caching permissions across requests. */
export async function builtinPermissionMap(db: Pick<Tx, 'roleDefinition'>): Promise<Record<ProjectRole, Permission[]>> {
  const overrides = await db.roleDefinition.findMany({ where: { key: { in: BUILTIN_ROLES } }, select: { key: true, permissions: true } });
  return { ...BUILTIN_ROLE_PERMISSIONS, ...Object.fromEntries(overrides.map((row) => [row.key, normalizePermissions(row.permissions)])) };
}
