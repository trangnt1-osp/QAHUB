import { useQuery } from '@tanstack/react-query';
import type { ProjectRole, SystemRole } from '@ospm/shared';
import { getAttachmentUrl, listLabels, listProjectMembers, listUsers, listWorkflowTemplates, getWorkflow, listTestCategories } from './generated/api';
import type { LabelBrief, UserBrief, WorkflowSnapshot } from './models';

export interface MemberRow { id: number; userId: number; role: ProjectRole; joinedAt: string; leftAt: string | null; user: UserBrief & { email: string; isActive: boolean } }

export const useMembers = (projectKey?: string) =>
  useQuery<MemberRow[]>({ queryKey: ['members', projectKey], queryFn: () => listProjectMembers(projectKey!), enabled: !!projectKey, staleTime: 60_000 });

export const useMembershipHistory = (projectKey: string) =>
  useQuery<MemberRow[]>({ queryKey: ['members', projectKey, 'history'], queryFn: () => listProjectMembers(projectKey, { status: 'all' }), enabled: !!projectKey });

export const useLabels = (projectKey?: string) =>
  useQuery<LabelBrief[]>({ queryKey: ['labels', projectKey], queryFn: () => listLabels(projectKey!), enabled: !!projectKey, staleTime: 60_000 });

export const useWorkflow = (projectKey?: string) =>
  useQuery<WorkflowSnapshot>({ queryKey: ['workflow', projectKey], queryFn: () => getWorkflow(projectKey!), enabled: !!projectKey, staleTime: 30_000 });

export const useWorkflowTemplates = () => useQuery<{ id: number; name: string }[]>({ queryKey: ['workflow-templates'], queryFn: () => listWorkflowTemplates() });

export const useAllUsers = () =>
  useQuery<(UserBrief & { email: string; systemRole: SystemRole; isActive: boolean; lastLoginAt: string | null })[]>({ queryKey: ['users'], queryFn: () => listUsers() });

export const useTestCategories = (projectKey?: string) =>
  useQuery<{ id: number; name: string; position: number }[]>({ queryKey: ['test-categories', projectKey], queryFn: () => listTestCategories(projectKey!), enabled: !!projectKey, staleTime: 60_000 });

export const useAttachmentUrl = (id: string, enabled = true) =>
  useQuery<{ url: string; fileName: string; mimeType: string }>({ queryKey: ['attachment-url', id], queryFn: () => getAttachmentUrl(id), enabled, staleTime: 30 * 60_000 });

import { getBacklog } from './generated/api';
import type { Sprint } from './models';

/** Sprint đang active + future của dự án (lấy từ endpoint backlog, không cần endpoint riêng). */
export const useSprints = (projectKey?: string) =>
  useQuery<Sprint[]>({
    queryKey: ['sprints', projectKey],
    queryFn: async () => (await getBacklog(projectKey!, { limit: 1 } as any)).sprints.map((s: { sprint: Sprint }) => s.sprint),
    enabled: !!projectKey,
    staleTime: 30_000,
  });
