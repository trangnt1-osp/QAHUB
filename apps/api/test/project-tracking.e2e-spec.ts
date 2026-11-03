import { auth, createTestApp, setupProject, TestCtx } from './helpers';

describe('Project Sprint / Phase tracking', () => {
  let ctx: TestCtx;
  let tokens: Record<string, string>;
  let projectId: bigint;
  const api = '/api/v1';
  beforeAll(async () => {
    ctx = await createTestApp();
    const result = await setupProject(ctx, 'TRACK', 'Tối giản', { developer: 'tracking-dev@x.test', viewer: 'tracking-view@x.test' });
    tokens = result.tokens;
    projectId = BigInt(result.project.id);
  });
  afterAll(async () => { await ctx?.close(); });
  const patchMode = (mode: string) => ctx.http().patch(`${api}/projects/TRACK`).set(auth(tokens.admin)).send({ trackingMode: mode });
  const createPeriod = (body: object = {}) => ctx.http().post(`${api}/projects/TRACK/sprints`).set(auth(tokens.developer)).send(body);
  const list = () => ctx.http().get(`${api}/projects/TRACK/sprints`).set(auth(tokens.viewer));
  const start = (id: number) => ctx.http().post(`${api}/sprints/${id}/start`).set(auth(tokens.developer)).send({ startDate: '2026-11-01', endDate: '2026-11-30' });

  it('defaults to sprint, validates mode, and restricts configuration permissions', async () => {
    const project = await ctx.http().get(`${api}/projects/TRACK`).set(auth(tokens.viewer)).expect(200);
    expect(project.body.trackingMode).toBe('sprint');
    await patchMode('wrong').expect(400);
    await ctx.http().patch(`${api}/projects/TRACK`).set(auth(tokens.admin)).send({ trackingMode: null }).expect(400);
    await ctx.http().patch(`${api}/projects/TRACK`).set(auth(tokens.developer)).send({ trackingMode: 'phase' }).expect(403);
    await ctx.http().post(`${api}/projects/TRACK/sprints`).set(auth(tokens.viewer)).send({}).expect(403);
  });

  it('shares created periods and planned dates in management list and backlog', async () => {
    const created = await createPeriod({ name: 'Planned Sprint', startDate: '2026-11-01', endDate: '2026-11-15' }).expect(201);
    expect(created.body.kind).toBe('sprint');
    expect(created.body.startDate.slice(0, 10)).toBe('2026-11-01');
    const periods = await list().expect(200);
    expect(periods.body.find((p: any) => p.id === created.body.id)).toMatchObject({ issueCount: 0, openCount: 0 });
    const backlog = await ctx.http().get(`${api}/projects/TRACK/backlog`).set(auth(tokens.viewer)).expect(200);
    expect(backlog.body.sprints.some((p: any) => p.sprint.id === created.body.id)).toBe(true);
    await createPeriod({ startDate: '2026-02-30' }).expect(400);
    await createPeriod({ startDate: '2026-11-15', endDate: '2026-11-01' }).expect(422);
    await ctx.http().patch(`${api}/sprints/${created.body.id}`).set(auth(tokens.developer)).send({ endDate: '2026-10-01' }).expect(422);
  });

  it('runs phases in parallel, selects their active board and blocks completion with open items', async () => {
    await patchMode('phase').expect(200);
    const a = (await createPeriod({ name: 'Survey' }).expect(201)).body;
    const b = (await createPeriod({ name: 'Development' }).expect(201)).body;
    expect(a.kind).toBe('phase');
    await start(a.id).expect(200);
    await start(b.id).expect(200);
    const issue = (await ctx.http().post(`${api}/projects/TRACK/issues`).set(auth(tokens.developer)).send({ title: 'Phase task', type: 'task', sprintId: a.id }).expect(201)).body;
    const board = await ctx.http().get(`${api}/projects/TRACK/board?sprintId=${a.id}`).set(auth(tokens.viewer)).expect(200);
    expect(board.body.sprint.id).toBe(a.id);
    expect(board.body.activePeriods).toHaveLength(2);
    expect(JSON.stringify(board.body.lanes)).toContain(issue.key);
    const other = await ctx.http().get(`${api}/projects/TRACK/board?sprintId=${b.id}`).set(auth(tokens.viewer)).expect(200);
    expect(JSON.stringify(other.body.lanes)).not.toContain(issue.key);
    await ctx.http().post(`${api}/sprints/${a.id}/complete`).set(auth(tokens.developer)).send({ moveOpenIssuesTo: 'backlog' }).expect(422);
    await patchMode('sprint').expect(409);
    await ctx.http().patch(`${api}/sprints/${a.id}`).set(auth(tokens.developer)).send({ name: 'Survey renamed' }).expect(200);
    await ctx.http().delete(`${api}/sprints/${a.id}`).set(auth(tokens.developer)).expect(422);
    const done = await ctx.prisma.workflowStatus.findFirstOrThrow({ where: { projectId, category: 'done' } });
    await ctx.prisma.issue.update({ where: { id: BigInt(issue.id) }, data: { statusId: done.id } });
    await ctx.http().post(`${api}/sprints/${a.id}/complete`).set(auth(tokens.developer)).send({ moveOpenIssuesTo: 'backlog' }).expect(200);
    const fallback = await ctx.http().get(`${api}/projects/TRACK/board?sprintId=${a.id}`).set(auth(tokens.viewer)).expect(200);
    expect(fallback.body.sprint.id).toBe(b.id);
    await ctx.http().delete(`${api}/sprints/${a.id}`).set(auth(tokens.developer)).expect(422);
    await ctx.prisma.issue.update({ where: { id: BigInt(issue.id) }, data: { deletedAt: new Date() } });
    await ctx.http().delete(`${api}/sprints/${a.id}`).set(auth(tokens.developer)).expect(422);
    const periods = await list().expect(200);
    expect(periods.body.find((p: any) => p.id === a.id).issueCount).toBe(1);
    await ctx.http().post(`${api}/sprints/${b.id}/complete`).set(auth(tokens.developer)).send({ moveOpenIssuesTo: 'backlog' }).expect(200);
    await ctx.http().delete(`${api}/sprints/${b.id}`).set(auth(tokens.developer)).expect(204);
  });

  it('rejects allocations to a hidden period kind and cross-project period', async () => {
    const legacy = await ctx.prisma.sprint.findFirstOrThrow({ where: { projectId, name: 'Planned Sprint' } });
    await ctx.http().post(`${api}/projects/TRACK/issues`).set(auth(tokens.developer)).send({ title: 'Invalid allocation', type: 'task', sprintId: Number(legacy.id) }).expect(422);
    await setupProject(ctx, 'OTHER', 'Tối giản');
    const foreign = await ctx.http().post(`${api}/projects/OTHER/sprints`).set(auth(tokens.admin)).send({}).expect(201);
    await ctx.http().post(`${api}/projects/TRACK/issues`).set(auth(tokens.developer)).send({ title: 'Foreign allocation', type: 'task', sprintId: foreign.body.id }).expect(404);
  });

  it('serializes deletion against allocation and keeps one active sprint under concurrent starts', async () => {
    const fresh = await setupProject(ctx, 'RACE', 'Tối giản');
    const period = (await ctx.http().post(`${api}/projects/RACE/sprints`).set(auth(tokens.admin)).send({}).expect(201)).body;
    const [allocation, deletion] = await Promise.all([
      ctx.http().post(`${api}/projects/RACE/issues`).set(auth(tokens.admin)).send({ title: 'Concurrent allocation', type: 'task', sprintId: period.id }),
      ctx.http().delete(`${api}/sprints/${period.id}`).set(auth(tokens.admin)),
    ]);
    expect([201, 404]).toContain(allocation.status);
    if (allocation.status === 201) expect(deletion.status).toBe(422);
    else expect(deletion.status).toBe(204);
    const dangling = await ctx.prisma.issue.count({ where: { projectId: BigInt(fresh.project.id), sprint: { deletedAt: { not: null } } } });
    expect(dangling).toBe(0);
    const first = (await ctx.http().post(`${api}/projects/RACE/sprints`).set(auth(tokens.admin)).send({}).expect(201)).body;
    const second = (await ctx.http().post(`${api}/projects/RACE/sprints`).set(auth(tokens.admin)).send({}).expect(201)).body;
    const results = await Promise.all([first, second].map((p) => ctx.http().post(`${api}/sprints/${p.id}/start`).set(auth(tokens.admin)).send({ startDate: '2026-11-01', endDate: '2026-11-15' })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });
});
