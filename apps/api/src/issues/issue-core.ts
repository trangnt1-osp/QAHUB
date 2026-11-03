import { ERROR_CODES, rankBetween } from '@ospm/shared';
import { Prisma } from '@prisma/client';
import { notFound } from '../common/errors';
import { Tx } from '../common/prisma.service';
import { parseIssueKey } from '../common/project-context.service';

export const userBrief = { id: true, displayName: true, avatarUrl: true } as const;

export const issueInclude = {
  status: { select: { id: true, name: true, category: true, color: true } },
  assignee: { select: userBrief },
  reporter: { select: userBrief },
  apiKey: { select: { id: true, name: true } },
  labels: { include: { label: true } },
  modules: { include: { module: true } },
  functions: { include: { function: { include: { module: true } } } },
  epicRequirement: { include: { modules: { include: { module: true } }, epicLinks: { where: { function: { deletedAt: null } }, include: { function: { include: { module: true } } } } } },
  parent: { select: { id: true, number: true, title: true, type: true } },
} satisfies Prisma.IssueInclude;

export type IssueRow = Prisma.IssueGetPayload<{ include: typeof issueInclude }>;

export const issueKeyOf = (projectKey: string, number: bigint | number) => `${projectKey}-${number}`;

/** Chuẩn hóa một dòng issue thành JSON trả về cho client. */
export function toIssueDto(row: IssueRow, projectKey: string) {
  const { labels, parent, apiKey, modules: itemModules, functions: itemFunctions, epicRequirement, ...rest } = row;
  const modules = row.type === 'epic' && epicRequirement
    ? [...new Map([...epicRequirement.modules, ...itemModules].map(m => [m.moduleId, m])).values()]
    : itemModules;
  const functions = row.type === 'epic' && epicRequirement
    ? [...new Map([...epicRequirement.epicLinks, ...itemFunctions].map(f => [f.functionId, f])).values()]
    : itemFunctions;
  const relatedModules = [...new Map([...modules.map(m => m.module), ...functions.flatMap(f => f.function.module ? [f.function.module] : [])].map(m => [m.id, m])).values()];
  return {
    ...rest,
    key: issueKeyOf(projectKey, row.number),
    labels: labels.map((l) => ({ id: l.label.id, name: l.label.name, color: l.label.color, isSystem: l.label.isSystem })),
    parent: parent ? { id: parent.id, key: issueKeyOf(projectKey, parent.number), title: parent.title, type: parent.type } : null,
    modules: relatedModules.map(m => ({ id: m.id, code: m.code, name: m.name })),
    functions: functions.map(({ function: f }) => ({ id: f.id, code: f.code, name: f.name, moduleId: f.moduleId })),
    moduleIds: relatedModules.map(m => m.id), explicitModuleIds: modules.map(m => m.moduleId), functionIds: functions.map(f => f.functionId),
    createdByApiKey: apiKey,
  };
}

/** Cấp số kế tiếp cho mã item `{KEY}-{n}` (nguyên tử, an toàn khi song song). */
export async function allocateIssueNumber(tx: Tx, projectId: bigint): Promise<bigint> {
  const rows = await tx.$queryRaw<{ issue_seq: bigint }[]>`UPDATE projects SET issue_seq = issue_seq + 1 WHERE id = ${projectId} RETURNING issue_seq`;
  return rows[0].issue_seq;
}

/** Rank cuối cùng trong một "vùng" (sprint hoặc backlog) của dự án. */
export async function rankAtEnd(tx: Tx, projectId: bigint, sprintId: bigint | null): Promise<string> {
  const last = await tx.issue.findFirst({ where: { projectId, sprintId, deletedAt: null }, orderBy: [{ rank: 'desc' }, { id: 'desc' }], select: { rank: true } });
  return rankBetween(last?.rank ?? null, null);
}

/** Lấy rank giữa hai neighbor, chịu được dữ liệu trùng rank. */
export function safeRankBetween(prev: string | null, next: string | null): string {
  if (prev && next && prev >= next) return rankBetween(prev, null);
  return rankBetween(prev, next);
}

export async function findIssueByKey(tx: Tx, issueKey: string, opts: { includeDeleted?: boolean } = {}) {
  const { projectKey, number } = parseIssueKey(issueKey);
  const issue = await tx.issue.findFirst({
    where: { number, project: { key: projectKey, deletedAt: null }, ...(opts.includeDeleted ? {} : { deletedAt: null }) },
    include: { ...issueInclude, project: { select: { id: true, key: true } } },
  });
  if (!issue) throw notFound(ERROR_CODES.ISSUE_NOT_FOUND, `Không tìm thấy item ${issueKey}`);
  return issue;
}

/** Nội dung TipTap đơn giản: danh sách đoạn văn. */
export function doc(...paragraphs: (string | { text: string; href?: string }[])[]) {
  return {
    type: 'doc',
    content: paragraphs.map((p) => ({
      type: 'paragraph',
      content: (typeof p === 'string' ? [{ text: p }] : p).map((n) => ({
        type: 'text',
        text: n.text,
        ...('href' in n && n.href ? { marks: [{ type: 'link', attrs: { href: n.href } }] } : {}),
      })),
    })),
  };
}

export function ensureLabel(tx: Tx, projectId: bigint, name: string) {
  return tx.label.findUnique({ where: { projectId_name: { projectId, name } } });
}

/** Ghi lịch sử đổi trạng thái (bảng issue_status_changes dùng cho Summary). */
export function recordStatusChange(tx: Tx, issueId: bigint, fromId: bigint | null, toId: bigint, by: bigint | null) {
  return tx.issueStatusChange.create({ data: { issueId, fromStatusId: fromId, toStatusId: toId, changedBy: by } });
}
