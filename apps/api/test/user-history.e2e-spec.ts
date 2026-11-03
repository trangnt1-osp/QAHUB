import { ADMIN, auth, createTestApp, createUser, login, TestCtx } from './helpers';

describe('User details and project history', () => {
  let ctx: TestCtx;
  let admin: string;
  let member: string;
  let userId: string;
  let emptyId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    admin = await login(ctx, ADMIN.email, ADMIN.password);
    const user = await createUser(ctx, 'history-view@local.test', 'History person');
    userId = String(user.id);
    emptyId = String((await createUser(ctx, 'no-projects@local.test', 'No projects')).id);
    member = await login(ctx, 'history-view@local.test', 'Password1!');
    const project = await ctx.prisma.project.create({ data: { key: 'HIST', name: 'History project' } });
    const deleted = await ctx.prisma.project.create({ data: { key: 'OLD', name: 'Deleted project', deletedAt: new Date() } });
    await ctx.prisma.projectMember.createMany({ data: [
      { projectId: project.id, userId: user.id, role: 'viewer', joinedAt: new Date('2026-01-01'), leftAt: new Date('2026-01-10') },
      { projectId: project.id, userId: user.id, role: 'developer', joinedAt: new Date('2026-02-01') },
      { projectId: deleted.id, userId: user.id, role: 'tester', joinedAt: new Date('2025-01-01'), leftAt: new Date('2025-02-01') },
    ] });
  });
  afterAll(async () => { await ctx?.close(); });

  it('returns public user details and all participation periods newest first', async () => {
    const res = await ctx.http().get(`/api/v1/users/${userId}`).set(auth(admin)).expect(200);
    expect(res.body.user).toMatchObject({ email: 'history-view@local.test', displayName: 'History person', systemRole: 'member' });
    expect(res.body.user).not.toHaveProperty('passwordHash');
    expect(res.body.user).not.toHaveProperty('refreshTokens');
    expect(res.body.projects).toHaveLength(3);
    expect(res.body.projects.map((p: any) => p.role)).toEqual(['developer', 'viewer', 'tester']);
    expect(new Set(res.body.projects.map((p: any) => p.id)).size).toBe(3);
    expect(res.body.projects[0]).toMatchObject({ leftAt: null, project: { key: 'HIST', name: 'History project', deletedAt: null } });
    expect(res.body.projects[1].leftAt.slice(0, 10)).toBe('2026-01-10');
    expect(res.body.projects[2].project.deletedAt).not.toBeNull();
  });

  it('returns an empty history for a user who has not joined any projects', async () => {
    const res = await ctx.http().get(`/api/v1/users/${emptyId}`).set(auth(admin)).expect(200);
    expect(res.body.projects).toEqual([]);
  });

  it('returns USER_NOT_FOUND for a missing user', async () => {
    const res = await ctx.http().get('/api/v1/users/999999').set(auth(admin)).expect(404);
    expect(res.body.code).toBe('USER_NOT_FOUND');
  });

  it('denies access to non-admins and unauthenticated requests', async () => {
    await ctx.http().get(`/api/v1/users/${userId}`).set(auth(member)).expect(403);
    await ctx.http().get(`/api/v1/users/${userId}`).expect(401);
  });
});
