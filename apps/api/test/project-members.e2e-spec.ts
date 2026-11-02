import { ADMIN, auth, createTestApp, createUser, login, setupProject, TestCtx } from './helpers';

describe('Project membership history', () => {
  let ctx: TestCtx;
  let tokens: Record<string, string>;
  let systemAdmin: string;
  let userId: number;
  let token: string;
  const base = '/api/v1/projects/TEAM';

  beforeAll(async () => {
    ctx = await createTestApp();
    ({ tokens } = await setupProject(ctx, 'TEAM', 'Tối giản', { admin: 'project-admin@x.test', viewer: 'project-viewer@x.test' }));
    systemAdmin = await login(ctx, ADMIN.email, ADMIN.password);
    userId = Number((await createUser(ctx, 'history@x.test', 'History user')).id);
    token = await login(ctx, 'history@x.test', 'Password1!');
  });
  afterAll(async () => { await ctx?.close(); });

  it('records join date when adding a member and rejects duplicates', async () => {
    const res = await ctx.http().post(`${base}/members`).set(auth(tokens.admin))
      .send({ userId, role: 'developer', joinedAt: '2026-01-01' }).expect(201);
    expect(res.body.joinedAt?.slice(0, 10)).toBe('2026-01-01');
    const members = await ctx.http().get(`${base}/members`).set(auth(tokens.viewer)).expect(200);
    expect(members.body.find((m: any) => m.userId === userId)).toMatchObject({ role: 'developer', leftAt: null });
    await ctx.http().post(`${base}/members`).set(auth(tokens.admin)).send({ userId, role: 'viewer' }).expect(409);
  });

  it('rejects departure before join date and invalid dates', async () => {
    await ctx.http().post(`${base}/members/${userId}/leave`).set(auth(tokens.admin)).send({ leftAt: '2025-12-31' }).expect(400);
    await ctx.http().post(`${base}/members/${userId}/leave`).set(auth(tokens.admin)).send({ leftAt: '2026-02-30' }).expect(400);
    await ctx.http().post(`${base}/members/${userId}/leave`).set(auth(tokens.admin)).send({ leftAt: '9999-01-01' }).expect(400);
    await ctx.http().get(base).set(auth(token)).expect(200);
  });

  it('retains a departed member in history but revokes access everywhere', async () => {
    const project = await ctx.prisma.project.findUniqueOrThrow({ where: { key: 'TEAM' } });
    await ctx.http().post(`${base}/issues`).set(auth(tokens.admin)).send({ type: 'task', title: 'Previously assigned work', assigneeId: userId }).expect(201);
    await ctx.http().post(`${base}/members/${userId}/leave`).set(auth(tokens.admin)).send({ leftAt: '2026-01-02' }).expect(200);
    const active = await ctx.http().get(`${base}/members`).set(auth(tokens.viewer)).expect(200);
    expect(active.body.some((m: any) => m.userId === userId)).toBe(false);
    const history = await ctx.http().get(`${base}/members?status=all`).set(auth(tokens.admin)).expect(200);
    const departed = history.body.find((m: any) => m.userId === userId);
    expect(departed.joinedAt.slice(0, 10)).toBe('2026-01-01');
    expect(departed.leftAt.slice(0, 10)).toBe('2026-01-02');
    await ctx.http().get(base).set(auth(token)).expect(403);
    await ctx.http().get(`${base}/summary`).set(auth(token)).expect(403);
    const list = await ctx.http().get('/api/v1/projects').set(auth(token)).expect(200);
    expect(list.body.some((p: any) => p.key === 'TEAM')).toBe(false);
    const me = await ctx.http().get('/api/v1/auth/me').set(auth(token)).expect(200);
    expect(me.body.projects.some((p: any) => p.projectKey === 'TEAM')).toBe(false);
    const dashboard = await ctx.http().get('/api/v1/dashboard').set(auth(token)).expect(200);
    expect(dashboard.body.myWork.some((p: any) => p.projectKey === 'TEAM')).toBe(false);
    expect(await ctx.app.get((await import('../src/common/project-context.service')).ProjectContextService).roleOf({ id: BigInt(userId), systemRole: 'member' }, project.id)).toBeNull();
  });

  it('allows rejoining without losing the previous participation period', async () => {
    await ctx.http().post(`${base}/members`).set(auth(tokens.admin)).send({ userId, role: 'viewer', joinedAt: '2026-02-01' }).expect(201);
    const history = await ctx.http().get(`${base}/members?status=all`).set(auth(tokens.admin)).expect(200);
    const periods = history.body.filter((m: any) => m.userId === userId);
    expect(periods).toHaveLength(2);
    expect(new Set(periods.map((m: any) => m.id)).size).toBe(2);
    expect(periods.filter((m: any) => m.leftAt === null)).toHaveLength(1);
    await ctx.http().get(base).set(auth(token)).expect(200);
  });

  it('prevents viewers from changing members', async () => {
    await ctx.http().post(`${base}/members/${userId}/leave`).set(auth(tokens.viewer)).send({}).expect(403);
    await ctx.http().patch(`${base}/members/${userId}`).set(auth(tokens.viewer)).send({ role: 'admin' }).expect(403);
  });

  it('legacy removal records a departure and departed members cannot be promoted', async () => {
    await ctx.http().delete(`${base}/members/${userId}`).set(auth(tokens.admin)).expect(204);
    const history = await ctx.http().get(`${base}/members?status=all`).set(auth(tokens.admin)).expect(200);
    expect(history.body.filter((m: any) => m.userId === userId)).toHaveLength(2);
    expect(history.body.filter((m: any) => m.userId === userId).every((m: any) => m.leftAt !== null)).toBe(true);
    await ctx.http().patch(`${base}/members/${userId}`).set(auth(tokens.admin)).send({ role: 'admin' }).expect(404);
  });

  it('retained departed admins do not count toward the last active admin rule', async () => {
    const seeded = await ctx.prisma.user.findUniqueOrThrow({ where: { email: ADMIN.email } });
    const projectAdmin = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'project-admin@x.test' } });
    await ctx.http().post(`${base}/members/${seeded.id}/leave`).set(auth(systemAdmin)).send({}).expect(200);
    await ctx.http().post(`${base}/members/${projectAdmin.id}/leave`).set(auth(systemAdmin)).send({}).expect(422);
    await ctx.http().patch(`${base}/members/${projectAdmin.id}`).set(auth(systemAdmin)).send({ role: 'viewer' }).expect(422);
  });
});
