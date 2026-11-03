import type { ProjectRole } from './enums';

/** Menu, section and action permissions shared by API and UI. */
export const PERMISSION_CATALOG = [
  { key: 'project.structure.import', label: 'Import Module / Epic / Function', group: 'Dự án', requires: ['project.structure.view', 'requirement.create', 'requirement.edit'] },
  { key: 'issue.import', label: 'Import Backlog', group: 'Công việc', requires: ['issue.view', 'issue.create', 'issue.edit'] },
  { key: 'dashboard.view', label: 'Xem Dashboard', group: 'Dashboard', requires: [] },
  { key: 'project.view', label: 'Xem menu Dự án', group: 'Dự án', requires: [] },
  { key: 'project.structure.view', label: 'Xem Epic / Module', group: 'Dự án', requires: ['project.view'] },
  { key: 'project.info.view', label: 'Xem thông tin dự án', group: 'Thông tin dự án', requires: ['project.view'] },
  { key: 'project.info.edit', label: 'Sửa thông tin / chế độ theo dõi', group: 'Thông tin dự án', requires: ['project.info.view'] },
  { key: 'project.members.view', label: 'Xem thành viên dự án', group: 'Thành viên dự án', requires: ['project.info.view'] },
  { key: 'project.members.create', label: 'Thêm thành viên / gán vai trò', group: 'Thành viên dự án', requires: ['project.members.view'] },
  { key: 'project.members.edit', label: 'Đổi vai trò thành viên', group: 'Thành viên dự án', requires: ['project.members.view'] },
  { key: 'project.members.delete', label: 'Ghi nhận rời dự án', group: 'Thành viên dự án', requires: ['project.members.view'] },
  { key: 'project.summary.view', label: 'Xem Summary', group: 'Summary', requires: ['project.view', 'issue.view'] },
  { key: 'project.backlog.view', label: 'Xem Backlog', group: 'Backlog', requires: ['project.view', 'issue.view', 'period.view'] },
  { key: 'project.board.view', label: 'Xem Active Sprint / Phase', group: 'Active', requires: ['project.view', 'issue.view', 'period.view'] },
  { key: 'issue.view', label: 'Xem item / tìm nhanh', group: 'Công việc', requires: ['project.view'] },
  { key: 'issue.create', label: 'Thêm item', group: 'Công việc', requires: ['issue.view'] },
  { key: 'issue.edit', label: 'Sửa / phân bổ item', group: 'Công việc', requires: ['issue.view'] },
  { key: 'issue.delete', label: 'Xóa item của mình', group: 'Công việc', requires: ['issue.view'] },
  { key: 'issue.delete.any', label: 'Xóa item của mọi thành viên', group: 'Công việc', requires: ['issue.delete'] },
  { key: 'issue.transition', label: 'Chuyển trạng thái item', group: 'Công việc', requires: ['issue.view'] },
  { key: 'issue.triage', label: 'Duyệt bug tự động', group: 'Công việc', requires: ['issue.view'] },
  { key: 'issue.comment', label: 'Viết / sửa bình luận của mình', group: 'Công việc', requires: ['issue.view'] },
  { key: 'issue.links.edit', label: 'Quản lý liên kết item', group: 'Công việc', requires: ['issue.view'] },
  { key: 'workflow.bypass', label: 'Bỏ qua quy tắc chuyển trạng thái', group: 'Công việc', requires: ['issue.transition'] },
  { key: 'period.view', label: 'Xem Sprint / Phase', group: 'Sprint / Phase', requires: ['project.view'] },
  { key: 'period.create', label: 'Tạo Sprint / Phase', group: 'Sprint / Phase', requires: ['period.view'] },
  { key: 'period.edit', label: 'Sửa Sprint / Phase', group: 'Sprint / Phase', requires: ['period.view'] },
  { key: 'period.delete', label: 'Xóa Sprint / Phase', group: 'Sprint / Phase', requires: ['period.view'] },
  { key: 'period.start', label: 'Bắt đầu Sprint / Phase', group: 'Sprint / Phase', requires: ['period.view'] },
  { key: 'period.complete', label: 'Hoàn thành Sprint / Phase', group: 'Sprint / Phase', requires: ['period.view'] },
  { key: 'testcase.view', label: 'Xem Test cases và Epic / Function', group: 'Test cases', requires: ['project.view'] },
  { key: 'testcase.create', label: 'Thêm test case', group: 'Test cases', requires: ['testcase.view'] },
  { key: 'testcase.edit', label: 'Sửa / cập nhật kết quả test case', group: 'Test cases', requires: ['testcase.view'] },
  { key: 'testcase.delete', label: 'Xóa test case', group: 'Test cases', requires: ['testcase.view'] },
  { key: 'testcase.import', label: 'Import (thêm / cập nhật test case và cấu trúc)', group: 'Test cases', requires: ['testcase.view', 'testcase.create', 'testcase.edit', 'requirement.create', 'requirement.edit', 'testcase.bug.link', 'testcase.category.manage'] },
  { key: 'testcase.export', label: 'Export test case', group: 'Test cases', requires: ['testcase.view'] },
  { key: 'testcase.bug.link', label: 'Gắn / bỏ liên kết bug', group: 'Test cases', requires: ['testcase.view', 'issue.view'] },
  { key: 'testcase.category.manage', label: 'Quản lý category test case', group: 'Test cases', requires: ['testcase.view'] },
  { key: 'requirement.create', label: 'Thêm Epic / Function', group: 'Epic / Function', requires: ['project.structure.view'] },
  { key: 'requirement.edit', label: 'Sửa Epic / Function', group: 'Epic / Function', requires: ['project.structure.view'] },
  { key: 'requirement.delete', label: 'Xóa Epic / Function', group: 'Epic / Function', requires: ['project.structure.view'] },
  { key: 'settings.view', label: 'Xem menu Cấu hình', group: 'Cấu hình', requires: ['project.view'] },
  { key: 'settings.workflow.view', label: 'Xem cấu hình Workflow', group: 'Cấu hình / Workflow', requires: ['settings.view'] },
  { key: 'settings.workflow.edit', label: 'Sửa / áp dụng Workflow', group: 'Cấu hình / Workflow', requires: ['settings.workflow.view'] },
  { key: 'settings.general.view', label: 'Xem cấu hình chung', group: 'Cấu hình / Chung', requires: ['settings.view'] },
  { key: 'settings.general.edit', label: 'Sửa cấu hình chung / category', group: 'Cấu hình / Chung', requires: ['settings.general.view'] },
  { key: 'settings.labels.view', label: 'Xem cấu hình Label', group: 'Cấu hình / Label', requires: ['settings.view'] },
  { key: 'settings.labels.edit', label: 'Sửa / xóa Label', group: 'Cấu hình / Label', requires: ['settings.labels.view'] },
  { key: 'apikey.view', label: 'Xem menu API Keys', group: 'API Keys', requires: ['project.view'] },
  { key: 'apikey.manage', label: 'Tạo / thu hồi API Keys', group: 'API Keys', requires: ['apikey.view'] },
  { key: 'report.view', label: 'Xem Report / kết quả chạy', group: 'Report', requires: ['project.view'] },
  { key: 'report.issue.create', label: 'Tạo bug từ kết quả chạy', group: 'Report', requires: ['report.view', 'issue.create'] },
  { key: 'attachment.view', label: 'Xem / tải tệp đính kèm', group: 'Tệp đính kèm', requires: ['project.view'] },
  { key: 'attachment.create', label: 'Thêm tệp đính kèm', group: 'Tệp đính kèm', requires: ['attachment.view'] },
] as const;

export type Permission = (typeof PERMISSION_CATALOG)[number]['key'];
export const PERMISSION_KEYS: Permission[] = PERMISSION_CATALOG.map((entry) => entry.key);

export function normalizePermissions(input: readonly string[]): Permission[] {
  const selected = new Set<Permission>(input.filter((key): key is Permission => PERMISSION_KEYS.includes(key as Permission)));
  let added = true;
  while (added) {
    added = false;
    for (const entry of PERMISSION_CATALOG) if (selected.has(entry.key)) for (const parent of entry.requires) {
      if (!selected.has(parent)) { selected.add(parent); added = true; }
    }
  }
  return PERMISSION_KEYS.filter((key) => selected.has(key));
}

export function togglePermission(input: readonly Permission[], key: Permission, enabled: boolean): Permission[] {
  if (enabled) return normalizePermissions([...input, key]);
  const selected = new Set(input);
  selected.delete(key);
  let removed = true;
  while (removed) {
    removed = false;
    for (const entry of PERMISSION_CATALOG) if (selected.has(entry.key) && entry.requires.some((parent) => !selected.has(parent))) {
      selected.delete(entry.key); removed = true;
    }
  }
  return PERMISSION_KEYS.filter((permission) => selected.has(permission));
}

const VIEWER: Permission[] = ['dashboard.view', 'project.structure.view', 'project.view', 'project.info.view', 'project.members.view', 'project.summary.view', 'project.backlog.view', 'project.board.view', 'issue.view', 'period.view', 'testcase.view', 'testcase.export', 'report.view', 'attachment.view'];
const DEVELOPER: Permission[] = [...VIEWER, 'issue.create', 'issue.edit', 'issue.delete', 'issue.transition', 'issue.comment', 'issue.links.edit', 'period.create', 'period.edit', 'period.delete', 'period.start', 'period.complete', 'testcase.create', 'testcase.edit', 'testcase.import', 'testcase.bug.link', 'requirement.create', 'requirement.edit', 'report.issue.create', 'attachment.create'];
export const BUILTIN_ROLE_PERMISSIONS: Record<ProjectRole, Permission[]> = {
  viewer: normalizePermissions(VIEWER),
  developer: normalizePermissions([...DEVELOPER, 'project.structure.import', 'issue.import']),
  tester: normalizePermissions([...DEVELOPER, 'project.structure.import', 'issue.import', 'issue.triage', 'testcase.delete', 'requirement.delete', 'testcase.category.manage']),
  admin: [...PERMISSION_KEYS],
};

export interface RoleDefinitionRow {
  id: number | null; key: string; name: string; description: string | null; permissions: Permission[]; builtin: boolean; memberCount: number;
}
