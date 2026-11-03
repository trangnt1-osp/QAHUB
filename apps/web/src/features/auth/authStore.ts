import { create } from 'zustand';
import { getAccessToken, http, refreshAccessToken, setAccessToken } from '../../api/http';
import { atLeast } from '../../lib/permissions';
import { BUILTIN_ROLE_PERMISSIONS, type Permission, type ProjectRole } from '@ospm/shared';

export interface MeProject { projectId: number; projectKey: string; projectName: string; role: ProjectRole; roleId?: number | null; roleName?: string; permissions?: Permission[] }
export interface MeUser { id: number; email: string; displayName: string; avatarUrl: string | null; systemRole: 'admin' | 'member' }

interface AuthState {
  user: MeUser | null;
  projects: MeProject[];
  ready: boolean;
  /** Thử khôi phục phiên bằng refresh token (cookie). */
  init: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
  roleIn: (projectKey?: string) => ProjectRole | null;
  can: (projectKey: string | undefined, min: ProjectRole) => boolean;
  isSystemAdmin: () => boolean;
  hasPermission: (projectKey: string | undefined, permission: Permission) => boolean;
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  projects: [],
  ready: false,
  async init() {
    if (!getAccessToken()) await refreshAccessToken();
    if (getAccessToken()) await get().reload();
    set({ ready: true });
  },
  async reload() {
    const requestUser = get().user?.id;
    const { data } = await http.get('/api/v1/auth/me');
    if (!getAccessToken() || (requestUser !== undefined && get().user?.id !== requestUser)) return;
    set({ user: data.user, projects: data.projects });
  },
  async login(email, password) {
    const { data } = await http.post('/api/v1/auth/login', { email, password });
    setAccessToken(data.accessToken);
    await get().reload();
  },
  async logout() {
    await http.post('/api/v1/auth/logout').catch(() => undefined);
    setAccessToken(null);
    set({ user: null, projects: [] });
  },
  roleIn(projectKey) {
    if (!projectKey) return null;
    if (get().user?.systemRole === 'admin') return 'admin';
    return get().projects.find((p) => p.projectKey === projectKey)?.role ?? null;
  },
  can(projectKey, min) {
    if (get().projects.find((project) => project.projectKey === projectKey)?.roleId) return min === 'viewer' && get().hasPermission(projectKey, 'project.view');
    return atLeast(get().roleIn(projectKey), min);
  },
  hasPermission(projectKey, permission) {
    if (!projectKey) return false;
    if (get().user?.systemRole === 'admin') return true;
    const project = get().projects.find((entry) => entry.projectKey === projectKey);
    if (!project) return false;
    const permissions = project.permissions ?? (project.roleId ? [] : BUILTIN_ROLE_PERMISSIONS[project.role]);
    return permissions?.includes(permission) ?? false;
  },
  isSystemAdmin: () => get().user?.systemRole === 'admin',
}));

/** Hook tiện dụng: vai trò hiệu lực trong một dự án */
export const useProjectRole = (projectKey?: string) => {
  const roleIn = useAuth((s) => s.roleIn);
  useAuth((s) => s.projects); // re-render khi danh sách dự án đổi
  useAuth((s) => s.user);
  return roleIn(projectKey);
};
export const useCan = (projectKey: string | undefined, min: ProjectRole) => useAuth((state) => state.can(projectKey, min));
export const usePermission = (projectKey: string | undefined, permission: Permission) => useAuth((state) => state.hasPermission(projectKey, permission));
export const useAnyPermission = (projectKey: string | undefined, permissions: Permission[]) => useAuth((state) => permissions.some((permission) => state.hasPermission(projectKey, permission)));

export function landingPage() {
  const state = useAuth.getState();
  return state.isSystemAdmin() || state.projects.some((project) => state.hasPermission(project.projectKey, 'dashboard.view')) ? '/dashboard' : '/projects';
}
