import { ADMIN, auth, createTestApp, createUser, login, TestCtx } from './helpers';

describe('Edit users', () => {
  let ctx: TestCtx;
  let admin: string;
  let member: string;
  let userId: string;
  let adminId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    admin = await login(ctx, ADMIN.email, ADMIN.password);
    const user = await createUser(ctx, 'edit@local.test', 'Original');
    userId = String(user.id);
    member = await login(ctx, 'edit@local.test', 'Password1!');
    adminId = String((await ctx.prisma.user.findUniqueOrThrow({ where: { email: ADMIN.email } })).id);
  });
  afterAll(async () => { await ctx?.close(); });

  it('normalizes email and name, persists edits and allows login with the new email', async () => {
    const res = await ctx.http().patch(`/api/v1/users/${userId}`).set(auth(admin))
      .send({ email: '  Updated@local.test  ', displayName: '  Updated name  ' }).expect(200);
    expect(res.body).toMatchObject({ email: 'updated@local.test', displayName: 'Updated name' });
    const stored = await ctx.prisma.user.findUniqueOrThrow({ where: { id: BigInt(userId) } });
    expect(stored.email).toBe('updated@local.test');
    await login(ctx, 'updated@local.test', 'Password1!');
    await ctx.http().post('/api/v1/auth/login').send({ email: 'edit@local.test', password: 'Password1!' }).expect(401);
  });

  it('rejects duplicate emails without partially saving other fields', async () => {
    const res = await ctx.http().patch(`/api/v1/users/${userId}`).set(auth(admin))
      .send({ email: 'ADMIN@local.test', displayName: 'Must not save' }).expect(409);
    expect(res.body.code).toBe('EMAIL_TAKEN');
    expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: BigInt(userId) } })).displayName).toBe('Updated name');
  });

  it.each([{ email: 'invalid' }, { email: '' }, { email: null }, { displayName: '   ' }, { displayName: null }])('rejects invalid edit %j', async (body) => {
    await ctx.http().patch(`/api/v1/users/${userId}`).set(auth(admin)).send(body).expect(400);
  });

  it('allows keeping the same normalized email', async () => {
    await ctx.http().patch(`/api/v1/users/${userId}`).set(auth(admin)).send({ email: 'UPDATED@local.test' }).expect(200);
  });

  it('rejects edits from non-admins', async () => {
    await ctx.http().patch(`/api/v1/users/${userId}`).set(auth(member)).send({ displayName: 'Denied' }).expect(403);
  });

  it.each([{ systemRole: 'member' }, { isActive: false }])('prevents admin from changing own access %j', async (body) => {
    await ctx.http().patch(`/api/v1/users/${adminId}`).set(auth(admin)).send(body).expect(403);
    const stored = await ctx.prisma.user.findUniqueOrThrow({ where: { id: BigInt(adminId) } });
    expect(stored).toMatchObject({ systemRole: 'admin', isActive: true });
  });

  it('returns 404 for a missing user', async () => {
    await ctx.http().patch('/api/v1/users/999999').set(auth(admin)).send({ displayName: 'Missing' }).expect(404);
  });

  it('updates roles and deactivates users while revoking refresh tokens', async () => {
    await ctx.http().patch(`/api/v1/users/${userId}`).set(auth(admin)).send({ systemRole: 'admin' }).expect(200);
    expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: BigInt(userId) } })).systemRole).toBe('admin');
    await ctx.http().patch(`/api/v1/users/${userId}`).set(auth(admin)).send({ systemRole: 'member', isActive: false }).expect(200);
    expect(await ctx.prisma.refreshToken.count({ where: { userId: BigInt(userId), revokedAt: null } })).toBe(0);
    await ctx.http().get('/api/v1/auth/me').set(auth(member)).expect(401);
  });
});
