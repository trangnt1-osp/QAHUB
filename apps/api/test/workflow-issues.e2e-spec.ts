import { auth, createTestApp, setupProject, TestCtx } from './helpers';

describe('Projects, workflow, issues', () => {
  let ctx: TestCtx;
  let tokens: Record<string, string>;
  const api = (p: string) => `/api/v1${p}`;

  beforeAll(async () => {
    ctx = await createTestApp();
    ({ tokens } = await setupProject(ctx, 'ELMS', 'Có QA', { developer: 'dev@x.test', tester: 'tester@x.test', viewer: 'viewer@x.test' }));
    await setupProject(ctx, 'DEMO', 'Tối giản');
  });
  afterAll(() => ctx.close());

  it('manual item gets source=manual, label manual and initial manual status', async () => {
    const res = await ctx.http().post(api('/projects/ELMS/issues')).set(auth(tokens.developer)).send({ type: 'task', title: 'Việc thủ công' }).expect(201);
    expect(res.body.key).toBe('ELMS-1');
    expect(res.body.source).toBe('manual');
    expect(res.body.status.name).toBe('To Do');
    expect(res.body.labels.map((l: any) => l.name)).toEqual(['manual']);
  });

  it('project without To Do (Tối giản) starts manual items at In Progress', async () => {
    const adminToken = tokens.admin;
    const res = await ctx.http().post(api('/projects/DEMO/issues')).set(auth(adminToken)).send({ type: 'task', title: 'x' }).expect(201);
    expect(res.body.status.name).toBe('In Progress');
  });

  it('viewer cannot create items', async () => {
    const res = await ctx.http().post(api('/projects/ELMS/issues')).set(auth(tokens.viewer)).send({ type: 'task', title: 'x' }).expect(403);
    expect(res.body).toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
  });

  it('transition validation returns 422 TRANSITION_NOT_ALLOWED and admin bypasses', async () => {
    const created = await ctx.http().post(api('/projects/ELMS/issues')).set(auth(tokens.developer)).send({ type: 'task', title: 'T' }).expect(201);
    const statuses = (await ctx.http().get(api('/projects/ELMS/workflow/runtime')).set(auth(tokens.developer)).expect(200)).body.statuses;
    const done = statuses.find((s: any) => s.name === 'Done');
    const res = await ctx.http().post(api(`/issues/${created.body.key}/transitions`)).set(auth(tokens.developer)).send({ toStatusId: done.id }).expect(422);
    expect(res.body.code).toBe('TRANSITION_NOT_ALLOWED');
    const ok = await ctx.http().post(api(`/issues/${created.body.key}/transitions`)).set(auth(tokens.admin)).send({ toStatusId: done.id }).expect(200);
    expect(ok.body.status.name).toBe('Done');
    expect(ok.body.resolvedAt).not.toBeNull();
  });

  it('version conflict returns 409', async () => {
    const created = await ctx.http().post(api('/projects/ELMS/issues')).set(auth(tokens.developer)).send({ type: 'task', title: 'V' }).expect(201);
    await ctx.http().patch(api(`/issues/${created.body.key}`)).set(auth(tokens.developer)).send({ version: created.body.version, title: 'V2' }).expect(200);
    const res = await ctx.http().patch(api(`/issues/${created.body.key}`)).set(auth(tokens.developer)).send({ version: created.body.version, title: 'V3' }).expect(409);
    expect(res.body.code).toBe('VERSION_CONFLICT');
  });

  it('system labels cannot be removed from an item or edited', async () => {
    const created = await ctx.http().post(api('/projects/ELMS/issues')).set(auth(tokens.developer)).send({ type: 'task', title: 'L' }).expect(201);
    const upd = await ctx.http().patch(api(`/issues/${created.body.key}`)).set(auth(tokens.developer)).send({ version: created.body.version, labelIds: [] }).expect(200);
    expect(upd.body.labels.map((l: any) => l.name)).toContain('manual');
    const labels = (await ctx.http().get(api('/projects/ELMS/labels')).set(auth(tokens.developer)).expect(200)).body;
    const manual = labels.find((l: any) => l.name === 'manual');
    const res = await ctx.http().delete(api(`/projects/ELMS/labels/${manual.id}`)).set(auth(tokens.admin)).expect(403);
    expect(res.body.code).toBe('SYSTEM_LABEL_LOCKED');
  });

  it('triage: accept / reject / duplicate; board never shows Pending Review', async () => {
    const wf = (await ctx.http().get(api('/projects/ELMS/workflow')).set(auth(tokens.admin)).expect(200)).body;
    const pending = wf.statuses.find((s: any) => s.name === 'Pending Review');
    expect(pending.showOnBoard).toBe(false);
    const mk = async (title: string) => {
      const prisma = ctx.prisma;
      const project = await prisma.project.findUniqueOrThrow({ where: { key: 'ELMS' } });
      const settings = await prisma.workflowSettings.findUniqueOrThrow({ where: { projectId: project.id } });
      const n = (await prisma.project.update({ where: { id: project.id }, data: { issueSeq: { increment: 1 } } })).issueSeq;
      const i = await prisma.issue.create({ data: { projectId: project.id, number: n, type: 'bug', title, statusId: settings.initialAutoStatusId, source: 'auto', rank: 'z' + n } });
      return `ELMS-${i.number}`;
    };
    const [a, b, c] = [await mk('bug a'), await mk('bug b'), await mk('bug c')];
    await ctx.http().post(api(`/issues/${a}/triage`)).set(auth(tokens.developer)).send({ action: 'accept' }).expect(403);
    const acc = await ctx.http().post(api(`/issues/${a}/triage`)).set(auth(tokens.tester)).send({ action: 'accept' }).expect(200);
    expect(acc.body.status.name).toBe('To Do');
    await ctx.http().post(api(`/issues/${b}/triage`)).set(auth(tokens.tester)).send({ action: 'reject' }).expect(400);
    const rej = await ctx.http().post(api(`/issues/${b}/triage`)).set(auth(tokens.tester)).send({ action: 'reject', reason: 'không phải bug' }).expect(200);
    expect(rej.body).toMatchObject({ resolution: 'rejected' });
    expect(rej.body.status.name).toBe('Rejected');
    const dup = await ctx.http().post(api(`/issues/${c}/triage`)).set(auth(tokens.tester)).send({ action: 'duplicate', duplicateOfKey: a }).expect(200);
    expect(dup.body.resolution).toBe('duplicate');
    await ctx.http().post(api(`/issues/${a}/triage`)).set(auth(tokens.tester)).send({ action: 'accept' }).expect(422);

    // sprint + board
    const sp = (await ctx.http().post(api('/projects/ELMS/sprints')).set(auth(tokens.developer)).send({}).expect(201)).body;
    expect(sp.name).toBe('ELMS Sprint 1');
    await ctx.http().post(api(`/issues/${a}/rank`)).set(auth(tokens.developer)).send({ sprintId: Number(sp.id) }).expect(200);
    await ctx.http().post(api(`/sprints/${sp.id}/start`)).set(auth(tokens.developer)).send({ startDate: '2026-11-01', endDate: '2026-11-14' }).expect(200);
    const sp2 = (await ctx.http().post(api('/projects/ELMS/sprints')).set(auth(tokens.developer)).send({}).expect(201)).body;
    await ctx.http().post(api(`/sprints/${sp2.id}/start`)).set(auth(tokens.developer)).send({ startDate: '2026-11-01', endDate: '2026-11-14' }).expect(409);
    const board = (await ctx.http().get(api('/projects/ELMS/board')).set(auth(tokens.viewer)).expect(200)).body;
    expect(board.columns.map((c: any) => c.name)).toEqual(['To Do', 'In Progress', 'PR In Review', 'Ready for QA', 'Deployed QA', 'Done']);
    expect(JSON.stringify(board)).not.toContain('Pending Review');
    const backlog = (await ctx.http().get(api('/projects/ELMS/backlog')).set(auth(tokens.viewer)).expect(200)).body;
    expect(backlog.sprints[0].issues.map((i: any) => i.key)).toContain(a);
    const summary = (await ctx.http().get(api('/projects/ELMS/summary')).set(auth(tokens.viewer)).expect(200)).body;
    expect(summary.statusOverview.total).toBeGreaterThan(0);
    expect(summary.bySource.auto).toBe(1);
    const allBugSummary = (await ctx.http().get(api('/projects/ELMS/summary?scope=all')).set(auth(tokens.viewer)).expect(200)).body;
    expect(allBugSummary.bySource.auto).toBe(3);
    const dash = (await ctx.http().get(api('/dashboard')).set(auth(tokens.tester)).expect(200)).body;
    expect(dash.canTriage).toBe(true);

    // sprint 1 complete moves open issues to backlog
    const done = await ctx.http().post(api(`/sprints/${sp.id}/complete`)).set(auth(tokens.developer)).send({ moveOpenIssuesTo: 'backlog' }).expect(200);
    expect(done.body.open).toBe(1);
  });

  it('filters backlog drill-downs by priority, assignment, open status and creation date', async () => {
    const create = async (title: string, extra: Record<string, unknown> = {}) =>
      (await ctx.http().post(api('/projects/ELMS/issues')).set(auth(tokens.admin)).send({ type: 'bug', title, ...extra }).expect(201)).body;
    const developer = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'dev@x.test' } });
    const highest = await create('Filter highest open', { priority: 'highest' });
    const assigned = await create('Filter assigned open', { assigneeId: Number(developer.id) });
    const closed = await create('Filter closed bug');
    const old = await create('Filter old bug');
    await ctx.prisma.issue.update({ where: { id: BigInt(old.id) }, data: { createdAt: new Date('2020-01-01T00:00:00.000Z') } });
    const workflow = (await ctx.http().get(api('/projects/ELMS/workflow')).set(auth(tokens.admin)).expect(200)).body;
    const done = workflow.statuses.find((status: any) => status.category === 'done');
    await ctx.http().post(api(`/issues/${closed.key}/transitions`)).set(auth(tokens.admin)).send({ toStatusId: done.id }).expect(200);
    const list = async (query: string) => (await ctx.http().get(api(`/projects/ELMS/issues?type=bug&${query}`)).set(auth(tokens.viewer)).expect(200)).body.items;

    expect((await list('priority=highest')).map((item: any) => item.key)).toContain(highest.key);
    expect((await list('priority=highest')).map((item: any) => item.key)).not.toContain(assigned.key);
    expect((await list('assigneeIds=unassigned')).map((item: any) => item.key)).not.toContain(assigned.key);
    expect((await list('statusCategory=open')).map((item: any) => item.key)).not.toContain(closed.key);
    expect((await list(`createdFrom=${new Date().toISOString().slice(0, 10)}`)).map((item: any) => item.key)).not.toContain(old.key);
  });

  it('workflow save: archive status with items requires replacement; triage cannot be on board', async () => {
    const wf = (await ctx.http().get(api('/projects/ELMS/workflow')).set(auth(tokens.admin)).expect(200)).body;
    const body = (statuses: any[]) => ({
      statuses,
      transitions: wf.transitions.map((t: any) => ({ from: t.fromStatusId === null ? null : String(t.fromStatusId), to: String(t.toStatusId), name: t.name ?? undefined })),
      settings: {
        initialManual: String(wf.settings.initialManualStatusId), initialAuto: String(wf.settings.initialAutoStatusId),
        accept: String(wf.settings.acceptStatusId), reject: String(wf.settings.rejectStatusId),
      },
    });
    const all = wf.statuses.filter((s: any) => !s.isArchived).map((s: any) => ({ id: Number(s.id), name: s.name, category: s.category, color: s.color, showOnBoard: s.showOnBoard }));
    const bad = all.map((s: any) => (s.name === 'Pending Review' ? { ...s, showOnBoard: true } : s));
    const r1 = await ctx.http().put(api('/projects/ELMS/workflow')).set(auth(tokens.admin)).send(body(bad)).expect(422);
    expect(r1.body.code).toBe('TRIAGE_STATUS_NOT_ON_BOARD');

    const todo = wf.statuses.find((s: any) => s.name === 'To Do');
    const withoutTodo = all.filter((s: any) => s.name !== 'To Do');
    const payload = body(withoutTodo);
    payload.transitions = payload.transitions.filter((t: any) => t.from !== String(todo.id) && t.to !== String(todo.id));
    payload.settings.initialManual = String(wf.statuses.find((s: any) => s.name === 'In Progress').id);
    payload.settings.accept = payload.settings.initialManual;
    const r2 = await ctx.http().put(api('/projects/ELMS/workflow')).set(auth(tokens.admin)).send(payload).expect(422);
    expect(r2.body.code).toBe('STATUS_IN_USE');
    const inProg = String(wf.statuses.find((s: any) => s.name === 'In Progress').id);
    const r3 = await ctx.http().put(api('/projects/ELMS/workflow')).set(auth(tokens.admin)).send({ ...payload, statusReplacements: { [String(todo.id)]: inProg } }).expect(200);
    expect(r3.body.statuses.find((s: any) => s.name.startsWith('To Do')).isArchived).toBe(true);
    const board = (await ctx.http().get(api('/projects/ELMS/board')).set(auth(tokens.viewer)).expect(200)).body;
    expect(board.columns.map((c: any) => c.name)).not.toContain('To Do');
  });
});
