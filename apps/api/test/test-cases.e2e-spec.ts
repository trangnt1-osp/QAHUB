import ExcelJS from 'exceljs';
import { auth, createTestApp, setupProject, TestCtx } from './helpers';

const api = (p: string) => `/api/v1${p}`;

describe('Test cases', () => {
  let ctx: TestCtx;
  let t: Record<string, string>;
  let fnId: number;
  let epicId: number;

  beforeAll(async () => {
    ctx = await createTestApp();
    ({ tokens: t } = await setupProject(ctx, 'ELMS', 'Có QA', { developer: 'dev@x.test', tester: 'tester@x.test', viewer: 'viewer@x.test' }));
    epicId = (await ctx.http().post(api('/projects/ELMS/requirements')).set(auth(t.developer)).send({ kind: 'epic', code: 'NDS-E-00946', name: 'Điểm số' }).expect(201)).body.id;
    fnId = (await ctx.http().post(api('/projects/ELMS/requirements')).set(auth(t.developer)).send({
      kind: 'function', code: 'NDS-U-00796', name: 'Xem lịch sử điểm', traceRef: 'UC 48', sources: ['docs/ba/uc48.docx'], epicIds: [epicId],
    }).expect(201)).body.id;
  });
  afterAll(() => ctx.close());

  it('generates code CL_{function}-{seq 3 digits} and automation tag', async () => {
    const res = await ctx.http().post(api('/projects/ELMS/test-cases')).set(auth(t.developer)).send({
      functionId: fnId, title: 'Hiển thị điểm', priority: 'high', steps: [{ action: 'Mở trang', expected: 'Thấy bảng' }, { action: 'Bấm lọc', expected: 'Lọc đúng' }],
    }).expect(201);
    expect(res.body.code).toBe('CL_NDS-U-00796-001');
    expect(res.body.automationTag).toBe('@CL_NDS-U-00796-001');
    expect(res.body.steps).toHaveLength(2);
    expect(res.body.steps[1].no).toBe(2);
    const second = await ctx.http().post(api('/projects/ELMS/test-cases')).set(auth(t.developer)).send({ functionId: fnId, title: 'Case 2' }).expect(201);
    expect(second.body.code).toBe('CL_NDS-U-00796-002');
    await ctx.http().post(api('/projects/ELMS/test-cases')).set(auth(t.viewer)).send({ functionId: fnId, title: 'x' }).expect(403);
  });

  it('list is compact (no steps), supports cursor pagination, filters and sort', async () => {
    for (let i = 3; i <= 25; i++) {
      await ctx.http().post(api('/projects/ELMS/test-cases')).set(auth(t.developer)).send({ functionId: fnId, title: `Case ${i}`, priority: i % 2 ? 'low' : 'critical' }).expect(201);
    }
    const p1 = (await ctx.http().get(api(`/projects/ELMS/test-cases?functionId=${fnId}&limit=10`)).set(auth(t.viewer)).expect(200)).body;
    expect(p1.items).toHaveLength(10);
    expect(p1.items[0].steps).toBeUndefined();
    expect(p1.items[0].stepCount).toBe(2);
    expect(p1.items[0].code).toBe('CL_NDS-U-00796-001');
    const p2 = (await ctx.http().get(api(`/projects/ELMS/test-cases?functionId=${fnId}&limit=10&cursor=${p1.nextCursor}`)).set(auth(t.viewer)).expect(200)).body;
    const p3 = (await ctx.http().get(api(`/projects/ELMS/test-cases?functionId=${fnId}&limit=10&cursor=${p2.nextCursor}`)).set(auth(t.viewer)).expect(200)).body;
    expect(p3.nextCursor).toBeNull();
    const codes = [...p1.items, ...p2.items, ...p3.items].map((i: any) => i.code);
    expect(codes).toHaveLength(25);
    expect(new Set(codes).size).toBe(25);
    expect(codes).toEqual([...codes].sort());

    const crit = (await ctx.http().get(api(`/projects/ELMS/test-cases?functionId=${fnId}&priority=critical&limit=100`)).set(auth(t.viewer)).expect(200)).body;
    expect(crit.items.every((i: any) => i.priority === 'critical')).toBe(true);
    const sorted = (await ctx.http().get(api(`/projects/ELMS/test-cases?functionId=${fnId}&sort=priority&limit=100`)).set(auth(t.viewer)).expect(200)).body.items.map((i: any) => i.priority);
    expect(sorted[0]).toBe('critical');
    expect(sorted.at(-1)).toBe('low');
    // phân trang khi sắp theo priority vẫn đủ và không trùng
    const seen = new Set<string>();
    let cursor = '';
    for (let i = 0; i < 10; i++) {
      const pg = (await ctx.http().get(api(`/projects/ELMS/test-cases?sort=priority:desc&limit=7${cursor}`)).set(auth(t.viewer)).expect(200)).body;
      for (const it of pg.items) { expect(seen.has(it.code)).toBe(false); seen.add(it.code); }
      if (!pg.nextCursor) break;
      cursor = `&cursor=${pg.nextCursor}`;
    }
    expect(seen.size).toBe(25);
    const search = (await ctx.http().get(api('/projects/ELMS/test-cases?q=Hiển%20thị')).set(auth(t.viewer)).expect(200)).body.items;
    expect(search.map((i: any) => i.code)).toEqual(['CL_NDS-U-00796-001']);
    const byEpic = (await ctx.http().get(api(`/projects/ELMS/test-cases?epicId=${epicId}&limit=500`)).set(auth(t.viewer)).expect(200)).body.items;
    expect(byEpic).toHaveLength(25);
    const ids = (await ctx.http().get(api(`/projects/ELMS/test-cases/ids?functionId=${fnId}&priority=low`)).set(auth(t.viewer)).expect(200)).body;
    expect(ids.total).toBeGreaterThan(5);
  });

  it('PATCH requires version, returns 409 with the other editor, and records versions', async () => {
    const tc = (await ctx.http().get(api(`/projects/ELMS/test-cases?functionId=${fnId}&limit=1`)).set(auth(t.viewer))).body.items[0];
    const ok = await ctx.http().patch(api(`/test-cases/${tc.id}`)).set(auth(t.developer)).send({ version: tc.version, status: 'passed' }).expect(200);
    expect(ok.body.version).toBe(tc.version + 1);
    const conflict = await ctx.http().patch(api(`/test-cases/${tc.id}`)).set(auth(t.tester)).send({ version: tc.version, notes: 'x' }).expect(409);
    expect(conflict.body.code).toBe('VERSION_CONFLICT');
    expect(conflict.body.details.updatedBy.displayName).toBe('DEVELOPER');
    await ctx.http().patch(api(`/test-cases/${tc.id}`)).set(auth(t.developer)).send({ status: 'passed' }).expect(400);
    const detail = (await ctx.http().get(api(`/test-cases/${tc.id}`)).set(auth(t.viewer)).expect(200)).body;
    expect(detail.versions.map((v: any) => v.version)).toEqual([2, 1]);
  });

  it('bulk update and permissions on delete', async () => {
    const ids = (await ctx.http().get(api(`/projects/ELMS/test-cases/ids?functionId=${fnId}`)).set(auth(t.viewer))).body.ids.slice(0, 5);
    const res = await ctx.http().post(api('/projects/ELMS/test-cases/bulk')).set(auth(t.developer)).send({ ids: ids.map(String), set: { status: 'failed' } }).expect(200);
    expect(res.body.updated).toBe(5);
    const failed = (await ctx.http().get(api('/projects/ELMS/test-cases?status=failed&limit=100')).set(auth(t.viewer))).body.items;
    expect(failed).toHaveLength(5);
    await ctx.http().post(api('/projects/ELMS/test-cases/bulk')).set(auth(t.developer)).send({ ids: [String(ids[0])], set: { deleted: true } }).expect(403);
    await ctx.http().delete(api(`/test-cases/${ids[0]}`)).set(auth(t.developer)).expect(403);
    await ctx.http().delete(api(`/test-cases/${ids[0]}`)).set(auth(t.tester)).expect(204);
    const filterBulk = await ctx.http().post(api('/projects/ELMS/test-cases/bulk')).set(auth(t.tester)).send({ filter: { functionId: String(fnId), status: ['failed'] }, set: { status: 'not_started' } }).expect(200);
    expect(filterBulk.body.updated).toBe(4);
  });

  it('more than 1000 rows run as a background job', async () => {
    const fn2 = (await ctx.http().post(api('/projects/ELMS/requirements')).set(auth(t.developer)).send({ kind: 'function', code: 'BIG-U-1', name: 'Big' }).expect(201)).body.id;
    const rows = Array.from({ length: 1200 }, (_, i) => ({ projectId: 1n, functionId: BigInt(fn2), seq: i + 1, code: `CL_BIG-U-1-${i + 1}`, title: `t${i}`, rank: `r${String(i).padStart(5, '0')}` }));
    const proj = await ctx.prisma.project.findUniqueOrThrow({ where: { key: 'ELMS' } });
    await ctx.prisma.testCase.createMany({ data: rows.map((r) => ({ ...r, projectId: proj.id })) });
    const res = await ctx.http().post(api('/projects/ELMS/test-cases/bulk')).set(auth(t.developer)).send({ filter: { functionId: String(fn2) }, set: { priority: 'critical' } }).expect(200);
    expect(res.body.async).toBe(true);
    const job = (await ctx.http().get(api(`/jobs/${res.body.jobId}`)).set(auth(t.developer)).expect(200)).body;
    expect(job).toMatchObject({ state: 'completed', result: { updated: 1200 } });
    expect(await ctx.prisma.testCase.count({ where: { functionId: BigInt(fn2), priority: 'critical' } })).toBe(1200);
  });

  it('move keeps code, allocates a new seq; link bug / create bug from failed test case', async () => {
    const fn3 = (await ctx.http().post(api('/projects/ELMS/requirements')).set(auth(t.developer)).send({ kind: 'function', code: 'MV-U-1', name: 'Move target' }).expect(201)).body.id;
    const tc = (await ctx.http().get(api(`/projects/ELMS/test-cases?functionId=${fnId}&limit=1&q=Case 2`)).set(auth(t.viewer))).body.items[0];
    const moved = await ctx.http().post(api(`/test-cases/${tc.id}/move`)).set(auth(t.developer)).send({ functionId: fn3 }).expect(200);
    expect(moved.body).toMatchObject({ code: tc.code, seq: 1 });
    expect(Number(moved.body.functionId)).toBe(fn3);
    const bug = await ctx.http().post(api(`/test-cases/${tc.id}/bugs`)).set(auth(t.developer)).send({ createBug: true }).expect(201);
    expect(bug.body.key).toMatch(/^ELMS-\d+$/);
    const detail = (await ctx.http().get(api(`/test-cases/${tc.id}`)).set(auth(t.viewer))).body;
    expect(detail.status).toBe('failed');
    expect(detail.bugs[0].key).toBe(bug.body.key);
    const listed = (await ctx.http().get(api(`/projects/ELMS/test-cases?functionId=${fn3}`)).set(auth(t.viewer))).body.items[0];
    expect(listed.bugs[0].key).toBe(bug.body.key);
    await ctx.http().delete(api(`/test-cases/${tc.id}/bugs?issueKey=${bug.body.key}`)).set(auth(t.developer)).expect(204);
  });

  it('summary gives category × status and progress; requirement tree has counts', async () => {
    const s = (await ctx.http().get(api(`/projects/ELMS/test-cases/summary?functionId=${fnId}`)).set(auth(t.viewer)).expect(200)).body;
    expect(s.totals.total).toBe(s.matrix.reduce((a: number, r: any) => a + r.total, 0));
    expect(typeof s.progress).toBe('number');
    const tree = (await ctx.http().get(api('/projects/ELMS/requirements')).set(auth(t.viewer)).expect(200)).body;
    expect(tree.epics[0].code).toBe('NDS-E-00946');
    expect(tree.epics[0].functions[0]).toMatchObject({ code: 'NDS-U-00796', sources: ['docs/ba/uc48.docx'] });
    expect(tree.epics[0].functions[0].counts.total).toBeGreaterThan(0);
  });

  it('keeps execution progress consistent for function, epic and summary when results change', async () => {
    const epic = (await ctx.http().post(api('/projects/ELMS/requirements')).set(auth(t.admin)).send({ kind: 'epic', code: 'EXEC-E', name: 'Execution' }).expect(201)).body;
    const fn = (await ctx.http().post(api('/projects/ELMS/requirements')).set(auth(t.admin)).send({ kind: 'function', code: 'EXEC-F', name: 'Execution', epicIds: [epic.id] }).expect(201)).body;
    let failed: any;
    for (const status of ['passed', 'failed', 'blocked', 'na', 'not_started']) {
      const row = (await ctx.http().post(api('/projects/ELMS/test-cases')).set(auth(t.admin)).send({ functionId: fn.id, title: status, status }).expect(201)).body;
      if (status === 'failed') failed = row;
    }
    const check = async (progress: number) => {
      const tree = (await ctx.http().get(api('/projects/ELMS/requirements')).set(auth(t.viewer)).expect(200)).body;
      const node = tree.epics.find((e: any) => e.id === epic.id);
      expect(node).toMatchObject({ progress, counts: { total: 5 } });
      expect(node.functions[0]).toMatchObject({ progress, counts: { total: 5 } });
      for (const scope of [`functionId=${fn.id}`, `epicId=${epic.id}`]) {
        const summary = (await ctx.http().get(api(`/projects/ELMS/test-cases/summary?${scope}`)).set(auth(t.viewer)).expect(200)).body;
        expect(summary).toMatchObject({ progress, totals: { total: 5 } });
      }
    };
    await check(40);
    await ctx.http().patch(api(`/test-cases/${failed.id}`)).set(auth(t.admin)).send({ version: failed.version, status: 'not_started' }).expect(200);
    await check(20);
  });

  it('Excel export then import into a clean project round-trips epics, functions and cases', async () => {
    const exp = await ctx.http().post(api(`/projects/ELMS/test-cases/export?functionId=${fnId}`)).set(auth(t.viewer)).expect(202);
    const job = (await ctx.http().get(api(`/jobs/${exp.body.jobId}`)).set(auth(t.viewer)).expect(200)).body;
    expect(job.state).toBe('completed');
    expect(job.downloadUrl).toContain('fake-s3/get/');
    const buf = ctx.storage.blobs.get(job.result.objectKey)!;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as any);
    const ws = wb.worksheets[0];
    expect(ws.getCell('A2').value).toBe('Function');
    expect(ws.getCell('B2').value).toBe('NDS-U-00796');
    let headerRow = 0;
    ws.eachRow((r, n) => { if (r.getCell(1).value === 'Checklist ID') headerRow = n; });
    // -001 đã bị xóa và -002 đã chuyển sang function khác ở các bước trước
    expect(ws.getRow(headerRow + 1).getCell(1).value).toBe('CL_NDS-U-00796-003');

    // sang dự án khác
    const { tokens: t2 } = await setupProject(ctx, 'DEMO', 'Tối giản');
    const form = await ctx.http().post(api('/projects/DEMO/test-cases/import')).set(auth(t2.admin)).attach('file', buf, 'checklist.xlsx').expect(202);
    const preview = (await ctx.http().get(api(`/jobs/${form.body.jobId}`)).set(auth(t2.admin)).expect(200)).body;
    expect(preview.state).toBe('completed');
    expect(preview.result.testCases.create).toBeGreaterThan(10);
    expect(preview.result.functions.create).toBe(1);
    expect(await ctx.prisma.testCase.count({ where: { project: { key: 'DEMO' } } })).toBe(0); // xem trước chưa ghi
    const commit = await ctx.http().post(api('/projects/DEMO/test-cases/import/commit')).set(auth(t2.admin)).send({ previewJobId: form.body.jobId }).expect(202);
    const done = (await ctx.http().get(api(`/jobs/${commit.body.jobId}`)).set(auth(t2.admin)).expect(200)).body;
    expect(done.state).toBe('completed');
    const tree = (await ctx.http().get(api('/projects/DEMO/requirements')).set(auth(t2.admin))).body;
    expect(tree.epics[0].code).toBe('NDS-E-00946');
    expect(tree.epics[0].functions[0].code).toBe('NDS-U-00796');
    expect(tree.epics[0].functions[0].sources).toEqual(['docs/ba/uc48.docx']);
    const imported = (await ctx.http().get(api('/projects/DEMO/test-cases?limit=500')).set(auth(t2.admin))).body.items;
    const original = (await ctx.http().get(api(`/projects/ELMS/test-cases?functionId=${fnId}&limit=500`)).set(auth(t.viewer))).body.items;
    expect(imported).toHaveLength(original.length);
    expect(imported[0].code).toBe(original[0].code);
    expect(imported.map((i: any) => i.stepCount)).toEqual(original.map((i: any) => i.stepCount));
    expect(imported.map((i: any) => i.status)).toEqual(original.map((i: any) => i.status));
    // tạo tiếp case mới không đụng seq đã import
    const next = await ctx.http().post(api('/projects/DEMO/test-cases')).set(auth(t2.admin)).send({ functionId: tree.epics[0].functions[0].id, title: 'new' }).expect(201);
    expect(Number(next.body.seq)).toBeGreaterThan(original.length);
  });
});
