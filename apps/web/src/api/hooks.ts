import { useQuery } from '@tanstack/react-query';
import type { ProjectRole, SystemRole } from '@ospm/shared';
import { getAttachmentUrl, listLabels, listProjectMembers, listUsers, listWorkflowTemplates, getWorkflow, listTestCategories } from './generated/api';
import type { LabelBrief, UserBrief, WorkflowSnapshot } from './models';

export interface MemberRow { id: number; userId: number; role: ProjectRole; roleId?: number | null; roleName?: string; joinedAt: string; leftAt: string | null; user: UserBrief & { email: string; isActive: boolean } }

export const useMembers = (projectKey?: string) =>
  useQuery<MemberRow[]>({ queryKey: ['members', projectKey], queryFn: async () => (await http.get(`/api/v1/projects/${projectKey}/members/options`)).data, enabled: !!projectKey, staleTime: 60_000 });

export const useMembershipHistory = (projectKey: string) =>
  useQuery<MemberRow[]>({ queryKey: ['members', projectKey, 'history'], queryFn: () => listProjectMembers(projectKey, { status: 'all' }), enabled: !!projectKey });

export const useLabels = (projectKey?: string) =>
  useQuery<LabelBrief[]>({ queryKey: ['labels', projectKey], queryFn: () => listLabels(projectKey!), enabled: !!projectKey, staleTime: 60_000 });

export const useWorkflow = (projectKey?: string) =>
  useQuery<WorkflowSnapshot>({ queryKey: ['workflow', projectKey, 'runtime'], queryFn: async () => (await http.get(`/api/v1/projects/${projectKey}/workflow/runtime`)).data, enabled: !!projectKey, staleTime: 30_000 });

export const useWorkflowConfiguration = (projectKey?: string) =>
  useQuery<WorkflowSnapshot>({ queryKey: ['workflow', projectKey], queryFn: () => getWorkflow(projectKey!), enabled: !!projectKey });

export const useWorkflowTemplates = () => useQuery<{ id: number; name: string }[]>({ queryKey: ['workflow-templates'], queryFn: () => listWorkflowTemplates() });

export const useAllUsers = (enabled = true) =>
  useQuery<(UserBrief & { email: string; systemRole: SystemRole; isActive: boolean; lastLoginAt: string | null })[]>({ queryKey: ['users'], queryFn: () => listUsers(), enabled });

export const useTestCategories = (projectKey?: string) =>
  useQuery<{ id: number; name: string; position: number }[]>({ queryKey: ['test-categories', projectKey], queryFn: () => listTestCategories(projectKey!), enabled: !!projectKey, staleTime: 60_000 });

export const useAttachmentUrl = (id: string, enabled = true) =>
  useQuery<{ url: string; fileName: string; mimeType: string }>({ queryKey: ['attachment-url', id], queryFn: () => getAttachmentUrl(id), enabled, staleTime: 30 * 60_000 });

import { getProject } from './generated/api';
import { http } from './http';
import type { Sprint } from './models';

export const useProjectTracking = (projectKey?: string) => {
  const { data } = useQuery({ queryKey: ['project', projectKey], queryFn: () => getProject(projectKey!), enabled: !!projectKey, staleTime: 30_000 });
  return data?.trackingMode === 'phase' ? 'phase' : 'sprint';
};

/** Shared periods; closed records remain in project information for history. */
export const useSprints = (projectKey?: string) =>
  useQuery<Sprint[]>({
    queryKey: ['sprints', projectKey],
    queryFn: async () => (await http.get<Sprint[]>(`/api/v1/projects/${projectKey}/sprints`)).data.filter((period) => period.state !== 'closed'),
    enabled: !!projectKey,
    staleTime: 30_000,
  });
