import { syncIssueStructure } from '../issues/issue-structure';
import { parseId } from '../common/bigint';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ERROR_CODES, generateRanks, Permission, preconditionsText, rankBetween, TEST_CASE_PRIORITIES } from '@ospm/shared';
import ExcelJS from 'exceljs';
import { StorageService } from '../attachments/storage.service';
import { AppException, forbidden } from '../common/errors';
import { ProjectContextService } from '../common/project-context.service';
import { PrismaService, Tx } from '../common/prisma.service';
import { JobsService } from '../jobs/jobs.service';
import { JOBS, QueueService } from '../queue/queue.service';
import { progressOf } from './requirements.service';
import { formatCode, normalizeSteps } from './test-cases.service';

/**
 * Layout file Excel (mỗi function một sheet) — suy ra từ mô tả "mẫu checklist" ở mục 5/10 vì chưa có file mẫu gốc:
 *   A1 "Epic"      | B: mã epic (cách nhau bằng ",") | C: tên epic (cách nhau bằng "|")
 *   A2 "Function"  | B: mã function | C: tên function
 *   A3 "Trace Ref" | B
 *   A4 "Source"    | B: các đường dẫn, mỗi dòng một đường dẫn
 *   khối "Checklist Summary" (category × status + Progress)
 *   bảng: Checklist ID | Priority | Category | Checklist Item | Pre-conditions | Steps | Expected | Status | Link Bug | Notes
 * TODO: đối chiếu với file Excel mẫu thật của đội QA và chỉnh HEADERS/nhãn cho khớp.
 */
export const HEADERS = ['Checklist ID', 'Priority', 'Category', 'Checklist Item', 'Pre-conditions', 'Steps', 'Expected', 'Status', 'Link Bug', 'Notes'];

const STATUS_LABEL: Record<string, string> = { not_started: 'Not Started', passed: 'Passed', failed: 'Failed', blocked: 'Blocked', na: 'N/A' };
const PRIORITY_LABEL: Record<string, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '');
const STATUS_BY_NORM = new Map<string, string>([...Object.entries(STATUS_LABEL).map(([k, v]) => [norm(v), k] as const), ['na', 'na'], ['notstarted', 'not_started']]);

export interface ParsedRow {
  row: number; code: string; priority: string; category: string; title: string; preconditions: string;
  steps: { action: string; expected: string }[]; status: string; bugs: string[]; notes: string;
}
export interface ParsedSheet {
  name: string;
  epics: { code: string; name: string }[];
  module?: { code: string; name: string; description?: string };
  fn: { code: string; name: string; traceRef: string; sources: string[] };
  rows: ParsedRow[];
}
export interface ParseResult { sheets: ParsedSheet[]; warnings: { sheet: string; row?: number; message: string }[] }

const cellText = (c: ExcelJS.Cell): string => {
  const v: any = c.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return String(v.richText ? v.richText.map((r: any) => r.text).join('') : v.text ?? v.result ?? '').trim();
  return String(v).trim();
};

export function splitSteps(actions: string, expected: string): { action: string; expected: string }[] {
  const lines = (s: string) => s.split(/\r?\n/).map((l) => l.replace(/^\s*\d+[.)]\s*/, '').trim()).filter((l) => l.length > 0);
  const a = lines(actions);
  const e = lines(expected);
  const n = Math.max(a.length, e.length);
  return Array.from({ length: n }, (_, i) => ({ action: a[i] ?? '', expected: e[i] ?? '' }));
}

@Injectable()
export class ExcelService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService, private readonly storage: StorageService, private readonly queue: QueueService, private readonly jobs: JobsService, private readonly projectCtx: ProjectContextService) {}

  onModuleInit() {
    this.jobs.register(JOBS.TEST_CASES_EXPORT, (d) => this.runExport(d));
    this.jobs.register(JOBS.TEST_CASES_IMPORT, (d) => this.runImport(d));
  }

  // ---------- Xuất ----------

  async runExport(d: { projectId: string; functionId?: string; moduleId?: string; epicId?: string; userId: string }) {
    await this.authorizeJob(d, 'testcase.export');
    const projectId = BigInt(d.projectId);
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    const buffer = await this.buildWorkbook(projectId, d.functionId ? BigInt(d.functionId) : undefined, d.moduleId ? BigInt(d.moduleId) : undefined, d.epicId ? BigInt(d.epicId) : undefined);
    const fileName = `${project.key}-test-cases-${new Date().toISOString().slice(0, 10)}.xlsx`;
    const objectKey = `${project.key}/exports/${Date.now()}-${fileName}`;
    await this.storage.putObject(objectKey, buffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return { objectKey, fileName };
  }

  async buildWorkbook(projectId: bigint, functionId?: bigint, moduleId?: bigint, epicId?: bigint): Promise<Buffer> {
    const coverage = epicId ? await this.prisma.$queryRawUnsafe<{ function_id: bigint }[]>('SELECT function_id FROM epic_function_coverage WHERE epic_id=$1',epicId) : undefined;
    const fns = await this.prisma.requirement.findMany({ where: { ...(coverage ? { id: { in: coverage.map(r => r.function_id) } } : {}), ...(moduleId ? { moduleId } : {}), projectId, kind: 'function', deletedAt: null, ...(functionId ? { AND: [{ id: functionId }] } : {}) }, orderBy: [{ rank: 'asc' }, { id: 'asc' }] });
    const wb = new ExcelJS.Workbook();
    wb.creator = 'OSPM';
    const used = new Set<string>();
    for (const fn of fns) {
      const [links, sources, cases, cats] = await Promise.all([
        this.prisma.requirementLink.findMany({ where: { functionId: fn.id }, include: { epic: true } }),
        this.prisma.requirementSource.findMany({ where: { requirementId: fn.id }, orderBy: [{ position: 'asc' }, { id: 'asc' }] }),
        this.prisma.testCase.findMany({
          where: { functionId: fn.id, deletedAt: null }, orderBy: [{ rank: 'asc' }, { id: 'asc' }],
          include: { category: true, bugs: { include: { issue: { select: { number: true, project: { select: { key: true } } } } } } },
        }),
        this.prisma.testCategory.findMany({ where: { projectId }, orderBy: [{ position: 'asc' }, { id: 'asc' }] }),
      ]);
      let name = fn.code.replace(/[\\/?*[\]:]/g, '_').slice(0, 31);
      while (used.has(name)) name = name.slice(0, 28) + '_' + used.size;
      used.add(name);
      const ws = wb.addWorksheet(name);
      ws.addRow(['Epic', links.map((l) => l.epic.code).join(','), links.map((l) => l.epic.name).join('|')]);
      ws.addRow(['Function', fn.code, fn.name]);
      ws.addRow(['Trace Ref', fn.traceRef ?? '']);
      ws.addRow(['Source', sources.map((s) => s.path).join('\n')]);
      const module = fn.moduleId ? await this.prisma.projectModule.findUnique({ where: { id: fn.moduleId } }) : null;
      ws.addRow(module ? ['Module',module.code,module.name,module.description ?? ''] : []);
      ws.addRow(['Checklist Summary']).font = { bold: true };
      ws.addRow(['Category', ...Object.values(STATUS_LABEL), 'Total']).font = { bold: true };
      const tot = Object.fromEntries(Object.keys(STATUS_LABEL).map((status) => [status, cases.filter((t) => t.status === status).length]));
      for (const c of cats) {
        const mine = cases.filter((t) => t.categoryId === c.id);
        const row = Object.keys(STATUS_LABEL).map((s) => mine.filter((t) => t.status === s).length);
        ws.addRow([c.name, ...row, mine.length]);
      }
      ws.addRow(['Tested (%)', progressOf({ total: cases.length, passed: tot.passed, failed: tot.failed, na: tot.na })]);
      ws.addRow([]);
      const header = ws.addRow(HEADERS);
      header.font = { bold: true };
      header.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6F4FF' } }; });
      for (const t of cases) {
        const steps = normalizeSteps(t.steps as any);
        ws.addRow([
          t.code, PRIORITY_LABEL[t.priority], t.category?.name ?? '', t.title, preconditionsText(t.preconditions),
          steps.map((s) => `${s.no}. ${s.action}`).join('\n'), steps.map((s) => `${s.no}. ${s.expected}`).join('\n'),
          STATUS_LABEL[t.status], t.bugs.map((b) => `${b.issue.project.key}-${b.issue.number}`).join(', '), t.notes ?? '',
        ]);
      }
      [18, 12, 18, 50, 36, 50, 50, 14, 18, 30].forEach((w, i) => (ws.getColumn(i + 1).width = w));
      ws.views = [{ state: 'frozen', ySplit: header.number }];
    }
    if (!fns.length) wb.addWorksheet('Checklist').addRow(HEADERS);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // ---------- Nhập ----------

  async parse(buffer: Buffer): Promise<ParseResult> {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buffer as any);
    } catch {
      throw new AppException(422, ERROR_CODES.IMPORT_INVALID, 'Không đọc được file Excel (.xlsx)');
    }
    const out: ParseResult = { sheets: [], warnings: [] };
    for (const ws of wb.worksheets) {
      let headerRow = 0;
      ws.eachRow((row, n) => { if (!headerRow && norm(cellText(row.getCell(1))) === 'checklistid') headerRow = n; });
      if (!headerRow) { out.warnings.push({ sheet: ws.name, message: 'Bỏ qua sheet: không tìm thấy dòng tiêu đề "Checklist ID"' }); continue; }
      const info: Record<string, ExcelJS.Row> = {};
      for (let r = 1; r < headerRow; r++) { const row = ws.getRow(r); const label = norm(cellText(row.getCell(1))); if (label) info[label] = row; }
      const fnRow = info['function'];
      const fnCode = fnRow ? cellText(fnRow.getCell(2)) : '';
      if (!fnCode) { out.warnings.push({ sheet: ws.name, message: 'Bỏ qua sheet: thiếu dòng "Function" (mã function)' }); continue; }
      const epicCodes = info['epic'] ? cellText(info['epic'].getCell(2)).split(',').map((s) => s.trim()).filter(Boolean) : [];
      const epicNames = info['epic'] ? cellText(info['epic'].getCell(3)).split('|').map((s) => s.trim()) : [];
      const sheet: ParsedSheet = {
        name: ws.name,
        ...(info['module'] && cellText(info['module'].getCell(2)) ? { module: { code: cellText(info['module'].getCell(2)), name: cellText(info['module'].getCell(3)) || cellText(info['module'].getCell(2)), description: cellText(info['module'].getCell(4)) } } : {}),
        epics: epicCodes.map((code, i) => ({ code, name: epicNames[i] || code })),
        fn: {
          code: fnCode, name: cellText(fnRow.getCell(3)) || fnCode, traceRef: info['traceref'] ? cellText(info['traceref'].getCell(2)) : '',
          sources: info['source'] ? cellText(info['source'].getCell(2)).split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : [],
        },
        rows: [],
      };
      const cols = Object.fromEntries(Array.from({ length: ws.columnCount }, (_, i) => [norm(cellText(ws.getRow(headerRow).getCell(i + 1))), i + 1]));
      const col = (row: ExcelJS.Row, name: string) => (cols[norm(name)] ? cellText(row.getCell(cols[norm(name)])) : '');
      ws.eachRow((row, n) => {
        if (n <= headerRow) return;
        const title = col(row, 'Checklist Item');
        const code = col(row, 'Checklist ID');
        if (!title && !code) return;
        if (!title) { out.warnings.push({ sheet: ws.name, row: n, message: 'Bỏ qua dòng: thiếu Checklist Item' }); return; }
        const pr = norm(col(row, 'Priority'));
        const priority = (TEST_CASE_PRIORITIES as readonly string[]).find((p) => p === pr) ?? 'medium';
        if (pr && priority === 'medium' && pr !== 'medium') out.warnings.push({ sheet: ws.name, row: n, message: `Priority "${col(row, 'Priority')}" không hợp lệ, dùng Medium` });
        const stRaw = col(row, 'Status');
        const status = STATUS_BY_NORM.get(norm(stRaw)) ?? 'not_started';
        if (stRaw && !STATUS_BY_NORM.has(norm(stRaw))) out.warnings.push({ sheet: ws.name, row: n, message: `Status "${stRaw}" không hợp lệ, dùng Not Started` });
        sheet.rows.push({
          row: n, code, priority, category: col(row, 'Category'), title, preconditions: col(row, 'Pre-conditions'),
          steps: splitSteps(col(row, 'Steps'), col(row, 'Expected')), status,
          bugs: col(row, 'Link Bug').split(/[,\s;]+/).map((s) => s.trim().toUpperCase()).filter(Boolean), notes: col(row, 'Notes'),
        });
      });
      out.sheets.push(sheet);
    }
    if (!out.sheets.length) throw new AppException(422, ERROR_CODES.IMPORT_INVALID, 'File không có sheet nào đúng mẫu', out.warnings);
    return out;
  }

  /** Xem trước: đếm sẽ tạo/cập nhật gì, chưa ghi dữ liệu. */
  async preview(projectId: bigint, parsed: ParseResult) {
    const codes = parsed.sheets.flatMap((s) => s.rows.map((r) => r.code).filter(Boolean));
    const [existingCases, existingReqs, cats] = await Promise.all([
      this.prisma.testCase.findMany({ where: { projectId, code: { in: codes } }, select: { code: true, deletedAt: true } }),
      this.prisma.requirement.findMany({ where: { projectId }, select: { code: true, kind: true, deletedAt: true } }),
      this.prisma.testCategory.findMany({ where: { projectId } }),
    ]);
    const haveCase = new Set(existingCases.map((c) => c.code));
    const haveReq = new Set(existingReqs.map((r) => `${r.kind}:${r.code}`));
    const haveCat = new Set(cats.map((c) => c.name.toLowerCase()));
    const newEpics = new Set<string>(); const newFns = new Set<string>(); const newCats = new Set<string>();
    let create = 0; let update = 0;
    for (const s of parsed.sheets) {
      for (const e of s.epics) if (!haveReq.has(`epic:${e.code}`)) newEpics.add(e.code);
      if (!haveReq.has(`function:${s.fn.code}`)) newFns.add(s.fn.code);
      for (const r of s.rows) {
        if (r.category && !haveCat.has(r.category.toLowerCase())) newCats.add(r.category);
        if (r.code && haveCase.has(r.code)) update++; else create++;
      }
    }
    return {
      sheets: parsed.sheets.map((s) => ({ name: s.name, function: s.fn.code, rows: s.rows.length })),
      epics: { create: newEpics.size, codes: [...newEpics] }, functions: { create: newFns.size, codes: [...newFns] },
      testCases: { create, update }, newCategories: [...newCats], warnings: parsed.warnings.slice(0, 200),
    };
  }

  async commit(projectId: bigint, userId: bigint, parsed: ParseResult) {
    const stats = { epics: 0, functions: 0, created: 0, updated: 0, bugsLinked: 0 };
    for (const sheet of parsed.sheets) {
      await this.prisma.$transaction((tx) => this.commitSheet(tx, projectId, userId, sheet, stats), { timeout: 120_000 });
    }
    return stats;
  }

  private async upsertRequirement(tx: Tx, projectId: bigint, kind: 'epic' | 'function', code: string, name: string, extra: { traceRef?: string; moduleId?: bigint } = {}) {
    const found = await tx.requirement.findUnique({ where: { projectId_code: { projectId, code } } });
    if (found) {
      if(found.kind !== kind) throw new AppException(422, ERROR_CODES.IMPORT_INVALID, 'Mã yêu cầu đã thuộc loại khác');
      if (found.deletedAt || found.name !== name || (extra.moduleId !== undefined && found.moduleId !== extra.moduleId) || (extra.traceRef !== undefined && found.traceRef !== extra.traceRef)) {
        return { row: await tx.requirement.update({ where: { id: found.id }, data: { deletedAt: null, name, ...(extra.moduleId !== undefined ? { moduleId: extra.moduleId } : {}), ...(extra.traceRef !== undefined ? { traceRef: extra.traceRef || null } : {}) } }), created: false };
      }
      return { row: found, created: false };
    }
    const last = await tx.requirement.findFirst({ where: { projectId, kind, deletedAt: null }, orderBy: { rank: 'desc' } });
    return { row: await tx.requirement.create({ data: { projectId, kind, code, name, moduleId: extra.moduleId, traceRef: extra.traceRef || null, rank: rankBetween(last?.rank ?? null, null) } }), created: true };
  }

  private async commitSheet(tx: Tx, projectId: bigint, userId: bigint, sheet: ParsedSheet, stats: { epics: number; functions: number; created: number; updated: number; bugsLinked: number }) {
    // Restore the Module before activating a Function that still points at its old Module.
    const module = sheet.module ? await tx.projectModule.upsert({
      where: { projectId_code: { projectId, code: sheet.module.code } },
      create: { projectId, ...sheet.module },
      update: { name: sheet.module.name, description: sheet.module.description, deletedAt: null },
    }) : undefined;
    const fn = await this.upsertRequirement(tx, projectId, 'function', sheet.fn.code, sheet.fn.name, { traceRef: sheet.fn.traceRef, moduleId: module?.id });
    if (fn.created) stats.functions++;
    for (const e of sheet.epics) {
      const epic = await this.upsertRequirement(tx, projectId, 'epic', e.code, e.name);
      if (epic.created) stats.epics++;
      await tx.requirementLink.upsert({ where: { epicId_functionId: { epicId: epic.row.id, functionId: fn.row.id } }, update: {}, create: { epicId: epic.row.id, functionId: fn.row.id } });
    }
    if (sheet.fn.sources.length) {
      await tx.requirementSource.deleteMany({ where: { requirementId: fn.row.id } });
      await tx.requirementSource.createMany({ data: sheet.fn.sources.map((path, position) => ({ requirementId: fn.row.id, path, position })) });
    }
    const cats = new Map((await tx.testCategory.findMany({ where: { projectId } })).map((c) => [c.name.toLowerCase(), c.id]));
    let catPos = cats.size;
    for (const r of sheet.rows) {
      if (r.category && !cats.has(r.category.toLowerCase())) {
        cats.set(r.category.toLowerCase(), (await tx.testCategory.create({ data: { projectId, name: r.category, position: ++catPos } })).id);
      }
    }
    const existing = new Map((await tx.testCase.findMany({ where: { projectId, code: { in: sheet.rows.map((r) => r.code).filter(Boolean) } } })).map((t) => [t.code, t]));
    const takenSeq = new Set((await tx.testCase.findMany({ where: { functionId: fn.row.id }, select: { seq: true } })).map((t) => t.seq));
    let maxSeq = fn.row.lastCaseSeq;
    const lastRank = (await tx.testCase.findFirst({ where: { functionId: fn.row.id, deletedAt: null }, orderBy: { rank: 'desc' } }))?.rank ?? null;
    const toCreate: ParsedRow[] = [];
    const bugLinks: { code: string; keys: string[] }[] = [];

    for (const r of sheet.rows) {
      const cur = r.code ? existing.get(r.code) : undefined;
      const data = {
        title: r.title, priority: r.priority, categoryId: r.category ? cats.get(r.category.toLowerCase())! : null, preconditions: r.preconditions || null,
        steps: normalizeSteps(r.steps) as any, status: r.status, notes: r.notes || null,
      };
      if (cur) {
        const changed = cur.title !== data.title || cur.priority !== data.priority || cur.categoryId !== data.categoryId || (cur.preconditions ?? null) !== data.preconditions
          || cur.status !== data.status || (cur.notes ?? null) !== data.notes || JSON.stringify((cur.steps as any[]).map((s) => [s.action, s.expected])) !== JSON.stringify(r.steps.map((s) => [s.action, s.expected])) || !!cur.deletedAt;
        if (changed) {
          const upd = await tx.testCase.update({ where: { id: cur.id }, data: { ...data, deletedAt: null, version: { increment: 1 }, updatedBy: userId } });
          await tx.testCaseVersion.create({ data: { testCaseId: cur.id, version: upd.version, snapshot: { ...data, automationTag: upd.automationTag, functionId: upd.functionId } as any, changedBy: userId } });
          stats.updated++;
        }
      } else toCreate.push(r);
      if (r.bugs.length && r.code) bugLinks.push({ code: r.code, keys: r.bugs });
    }

    if (toCreate.length) {
      const ranks = generateRanks(toCreate.length, lastRank, null);
      const rows = toCreate.map((r, i) => {
        let seq = Number(/-(\d+)$/.exec(r.code)?.[1] ?? 0);
        if (!seq || takenSeq.has(seq)) { seq = maxSeq + 1; }
        while (takenSeq.has(seq)) seq++;
        takenSeq.add(seq);
        maxSeq = Math.max(maxSeq, seq);
        const code = r.code || formatCode(sheet.fn.code, seq);
        return {
          projectId, functionId: fn.row.id, seq, code, title: r.title, priority: r.priority, categoryId: r.category ? cats.get(r.category.toLowerCase())! : null,
          preconditions: r.preconditions || null, steps: normalizeSteps(r.steps) as any, status: r.status, notes: r.notes || null,
          automationTag: `@${code}`, rank: ranks[i], createdBy: userId, updatedBy: userId,
        };
      });
      for (let i = 0; i < rows.length; i += 1000) await tx.testCase.createMany({ data: rows.slice(i, i + 1000) });
      await tx.$executeRaw`
        INSERT INTO test_case_versions (test_case_id, version, snapshot, changed_by)
        SELECT id, 1, jsonb_build_object('title', title, 'priority', priority, 'categoryId', category_id, 'preconditions', preconditions,
               'steps', steps, 'status', status, 'notes', notes, 'automationTag', automation_tag, 'functionId', function_id), ${userId}
        FROM test_cases WHERE function_id = ${fn.row.id} AND code = ANY(${rows.map((r) => r.code)}) ON CONFLICT DO NOTHING`;
      stats.created += rows.length;
      // dòng mới không có code: gắn bug theo thứ tự đã sinh
      toCreate.forEach((r, i) => { if (!r.code && r.bugs.length) bugLinks.push({ code: rows[i].code, keys: r.bugs }); });
    }
    if (maxSeq > fn.row.lastCaseSeq) await tx.requirement.update({ where: { id: fn.row.id }, data: { lastCaseSeq: maxSeq } });

    // Link Bug
    const allKeys = [...new Set(bugLinks.flatMap((b) => b.keys))];
    if (allKeys.length) {
      const project = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
      const numbers = allKeys.filter((k) => k.startsWith(`${project.key}-`)).map((k) => BigInt(k.slice(project.key.length + 1) || 0));
      const issues = await tx.issue.findMany({ where: { projectId, number: { in: numbers }, deletedAt: null }, select: { id: true, number: true } });
      const issueByKey = new Map(issues.map((i) => [`${project.key}-${i.number}`, i.id]));
      const cases = new Map((await tx.testCase.findMany({ where: { projectId, code: { in: bugLinks.map((b) => b.code) } }, select: { id: true, code: true } })).map((t) => [t.code, t.id]));
      const data = bugLinks.flatMap((b) => b.keys.map((k) => ({ testCaseId: cases.get(b.code), issueId: issueByKey.get(k) }))).filter((d): d is { testCaseId: bigint; issueId: bigint } => !!d.testCaseId && !!d.issueId);
      for(const issueId of new Set(data.map(d => d.issueId))) {
        const linked=await tx.issue.findUniqueOrThrow({ where: { id: issueId }, include: { functions: true, epicRequirement: { include: { epicLinks: { where: { function: { deletedAt: null } } } } } } });
        const assigned=[...linked.functions,...(linked.epicRequirement?.epicLinks ?? [])];
        await syncIssueStructure(tx,issueId,projectId,undefined,[...assigned.map(f => Number(f.functionId)),Number(fn.row.id)]);
      }
      if (data.length) stats.bugsLinked += (await tx.testCaseBug.createMany({ data, skipDuplicates: true })).count;
    }
  }

  async runImport(d: { projectId: string; userId: string; objectKey: string; mode: 'preview' | 'commit' }) {
    await this.authorizeJob(d, 'testcase.import');
    const buffer = await this.storage.getObject(d.objectKey);
    let parsed: ParseResult;
    try {
      parsed = await this.parse(buffer);
    } catch (e) {
      (e as any).noRetry = true;
      throw e;
    }
    const projectId = BigInt(d.projectId);
    return d.mode === 'preview' ? { mode: 'preview', objectKey: d.objectKey, ...(await this.preview(projectId, parsed)) } : { mode: 'commit', ...(await this.commit(projectId, BigInt(d.userId), parsed)) };
  }

  async enqueueImport(projectId: bigint, userId: bigint, objectKey: string, mode: 'preview' | 'commit') {
    return this.queue.send(JOBS.TEST_CASES_IMPORT, { projectId: projectId.toString(), userId: userId.toString(), objectKey, mode });
  }

  private async authorizeJob(d: { projectId: string; userId: string }, permission: Permission) {
    const user = await this.prisma.user.findUnique({ where: { id: BigInt(d.userId) } });
    if (!user?.isActive) throw forbidden('Người thực hiện không còn hoạt động.');
    const project = await this.prisma.project.findFirst({ where: { id: BigInt(d.projectId), deletedAt: null }, select: { id: true } });
    if (!project) throw forbidden('Dự án không còn hoạt động.');
    await this.projectCtx.requirePermission(user, project.id, permission);
  }

  async enqueueExport(projectId: bigint, userId: bigint, functionId?: string, moduleId?: string, epicId?: string) {
    if(functionId) parseId(functionId); if(moduleId) parseId(moduleId); if(epicId) parseId(epicId);
    return this.queue.send(JOBS.TEST_CASES_EXPORT, { projectId: projectId.toString(), userId: userId.toString(), functionId, moduleId, epicId });
  }
}

