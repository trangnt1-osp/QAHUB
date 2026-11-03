// Kiểu hiển thị dùng ở giao diện. Backend chưa khai báo schema response nên các hook Orval trả `any`;
// request/DTO vẫn lấy từ api/generated/model. TODO: bổ sung @ApiResponse ở backend để Orval sinh nốt kiểu response.
import type { IssueSource, IssueType, Priority, StatusCategory } from '@ospm/shared';

export interface UserBrief { id: number; displayName: string; avatarUrl?: string | null }
export interface StatusBrief { id: number; name: string; category: StatusCategory; color: string }
export interface LabelBrief { id: number; name: string; color: string; isSystem: boolean }

export interface IssueRow {
  id: number; key: string; number: number; projectId: number; type: IssueType; title: string; priority: Priority; source: IssueSource;
  status: StatusBrief; statusId: number; assignee: UserBrief | null; reporter: UserBrief | null; labels: LabelBrief[];
  parent: { id: number; key: string; title: string; type: IssueType } | null; sprintId: number | null; rank: string;
  estimateMinutes: number | null; dueDate: string | null; version: number; occurrenceCount: number; createdAt: string; updatedAt: string;
  description?: unknown; resolution?: string | null; createdByApiKey?: { id: string; name: string } | null; lastSeenAt?: string | null; firstSeenAt?: string | null;
}

export interface Transition { statusId: number; name: string; category: StatusCategory; color: string; label: string | null }

export interface IssueDetail extends IssueRow {
  subtasks: Pick<IssueRow, 'id' | 'key' | 'title' | 'type' | 'status' | 'priority' | 'assignee'>[];
  links: { id: number; type: string; direction: 'inward' | 'outward'; issue: Pick<IssueRow, 'id' | 'key' | 'title' | 'type' | 'status'> }[];
  attachments: { id: string; kind: string; fileName: string; mimeType: string; sizeBytes: number | null }[];
  availableTransitions: Transition[];
  autoInfo: null | {
    occurrenceCount: number; firstSeenAt: string | null; lastSeenAt: string | null; fingerprint: string | null;
    lastRun: { id: number; environment?: string; branch?: string; commitSha?: string; ciUrl?: string } | null; file: string | null; line: number | null; errorMessage: string | null;
  };
}

export interface Sprint { id: number; name: string; kind?: 'sprint' | 'phase'; goal: string | null; state: 'future' | 'active' | 'closed'; startDate: string | null; endDate: string | null; issueCount?: number; doneCount?: number; openCount?: number }
export interface Page<T> { items: T[]; nextCursor: string | null }

export interface ProjectRow {
  id: number; key: string; name: string; description: string | null; lead: UserBrief | null; myRole: string | null;
  openIssues: number; pendingReview: number; activeSprint: { id: number; name: string } | null; createdAt: string;
  startDate: string | null; endDate: string | null;
}

export interface WorkflowStatus { id: number; name: string; category: StatusCategory; color: string; position: number; showOnBoard: boolean; isArchived: boolean; issueCount?: number }
export interface WorkflowSnapshot {
  statuses: WorkflowStatus[];
  transitions: { id: number; fromStatusId: number | null; toStatusId: number; name: string | null }[];
  settings: { initialManualStatusId: number; initialAutoStatusId: number; acceptStatusId: number | null; rejectStatusId: number | null; allowAnyTransition: boolean } | null;
}

export interface ActivityItem {
  id: number; actor: { id: number | null; displayName: string; avatarUrl?: string | null } | null; action: string; projectKey?: string;
  issueKey: string; issueTitle: string | null; changes: Record<string, unknown> | null; createdAt: string;
}

export interface TestCaseRow {
  id: number; code: string; seq: number; functionId: number; functionCode: string; title: string; priority: string; categoryId: number | null;
  categoryName: string | null; preconditions: string | null; stepCount: number; status: string; notes: string | null; automationTag: string | null;
  version: number; updatedAt: string; updatedBy: UserBrief | null; bugs: { id: number; key: string }[];
}
