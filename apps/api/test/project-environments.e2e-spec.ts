import { auth, createTestApp, setupProject, TestCtx } from './helpers';

describe('Project environments', () => {
  let ctx: TestCtx; let token: string; let viewer: string; let id: number; let ownerId: number;
  const base = '/api/v1/projects/ENV/environments';
  beforeAll(async () => {
    process.env.ENVIRONMENT_ACCOUNTS_KEY = Buffer.alloc(32, 7).toString('base64');
    ctx = await createTestApp();
    const setup = await setupProject(ctx, 'ENV', 'Tối giản', { viewer: 'env-viewer@test.local' });
    token = setup.tokens.admin; viewer = setup.tokens.viewer;
    ownerId = Number((await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'env-viewer@test.local' } })).id);
    await setupProject(ctx, 'OTHERENV', 'Tối giản');
  });
  afterAll(async () => ctx.close());
  it('stores multiple accounts encrypted, preserves passwords and isolates environments', async () => {
    const accounts = [{ username: 'qa@example.test', password: ' secret with spaces ', role: 'Tester', notes: 'VPN' }, { username: 'admin', password: 'another-secret', role: 'Admin', notes: '' }];
    const row = (await ctx.http().post(base).set(auth(token)).send({ name: 'Staging accounts', accounts }).expect(201)).body;
    expect(row.accounts).toEqual(accounts);
    expect(row).not.toHaveProperty('accountsEncrypted');
    const stored = await ctx.prisma.projectEnvironment.findUniqueOrThrow({ where: { id: BigInt(row.id) } });
    expect(stored.accountsEncrypted).toBeTruthy();
    expect(stored.accountsEncrypted).not.toContain('secret with spaces');
    const listed = (await ctx.http().get(base).set(auth(viewer)).expect(200)).body;
    expect(listed.find((item: { id: number }) => item.id === row.id).accounts).toEqual(accounts);
    await ctx.http().patch(`/api/v1/projects/OTHERENV/environments/${row.id}`).set(auth(token)).send({ version: 1, accounts: [] }).expect(404);
    await ctx.http().patch(`${base}/${row.id}`).set(auth(viewer)).send({ version: 1, accounts: [] }).expect(403);
    const updated = (await ctx.http().patch(`${base}/${row.id}`).set(auth(token)).send({ version: 1, notes: 'Preserve accounts' }).expect(200)).body;
    expect(updated.accounts).toEqual(accounts);
    expect((await ctx.http().patch(`${base}/${row.id}`).set(auth(token)).send({ version: 2, accounts: [] }).expect(200)).body.accounts).toEqual([]);
    await ctx.http().post(base).set(auth(token)).send({ name: 'Invalid account', accounts: [{ username: '', password: 'secret' }] }).expect(400);
    await ctx.http().delete(`${base}/${row.id}?version=3`).set(auth(token)).expect(204);
  });
  it('creates and reads project environment details; viewers cannot change them', async () => {
    const response = await ctx.http().post(base).set(auth(token)).send({ name: 'UAT', kind: 'uat', appUrl: 'https://uat.example.test', apiUrl: 'http://localhost:3000', deployedVersion: 'v1.2', ownerId, notes: 'VPN required', status: 'active' }).expect(201);
    id = response.body.id;
    expect(response.body).toMatchObject({ name: 'UAT', version: 1, owner: { id: ownerId } });
    expect((await ctx.http().get(base).set(auth(viewer)).expect(200)).body).toHaveLength(1);
    await ctx.http().post(base).set(auth(viewer)).send({ name: 'DEV', kind: 'dev' }).expect(403);
    await ctx.http().patch(`${base}/${id}`).set(auth(viewer)).send({ version: 1, name: 'No' }).expect(403);
    await ctx.http().delete(`${base}/${id}?version=1`).set(auth(viewer)).expect(403);
  });
  it('rejects duplicate names, unsafe URLs and owners outside the project', async () => {
    await ctx.http().post(base).set(auth(token)).send({ name: ' uat ', kind: 'uat' }).expect(409);
    await ctx.http().post(base).set(auth(token)).send({ name: 'Unsafe', kind: 'dev', appUrl: 'javascript:alert(1)' }).expect(400);
    await ctx.http().post(base).set(auth(token)).send({ name: 'Unsafe', kind: 'dev', apiUrl: 'https://user:password@example.test' }).expect(400);
    await ctx.http().post(base).set(auth(token)).send({ name: 'Invalid owner', kind: 'dev', ownerId: 999999 }).expect(422);
    await ctx.http().post(base).set(auth(token)).send({ name: '   ', kind: 'dev' }).expect(400);
  });
  it('updates with concurrency protection and prevents cross-project access', async () => {
    const row = (await ctx.http().patch(`${base}/${id}`).set(auth(token)).send({ version: 1, status: 'maintenance', appUrl: null, ownerId: null }).expect(200)).body;
    expect(row).toMatchObject({ version: 2, appUrl: null, ownerId: null, status: 'maintenance' });
    await ctx.http().patch(`${base}/${id}`).set(auth(token)).send({ version: 1, name: 'Stale' }).expect(409);
    await ctx.http().patch(`/api/v1/projects/OTHERENV/environments/${id}`).set(auth(token)).send({ version: 2, name: 'Wrong project' }).expect(404);
    await ctx.http().delete(`${base}/${id}?version=1`).set(auth(token)).expect(409);
    await ctx.http().delete(`${base}/${id}?version=2`).set(auth(token)).expect(204);
    expect((await ctx.http().get(base).set(auth(token))).body).toHaveLength(0);
    await ctx.http().patch(`${base}/${id}`).set(auth(token)).send({ version: 2, name: 'Deleted' }).expect(404);
  });
  it('retains historical owners on unrelated edits but rejects assigning members who have left', async () => {
    const row = (await ctx.http().post(base).set(auth(token)).send({ name: 'DEV', kind: 'dev', ownerId }).expect(201)).body;
    const project = await ctx.prisma.project.findUniqueOrThrow({ where: { key: 'ENV' } });
    await ctx.prisma.projectMember.updateMany({ where: { projectId: project.id, userId: BigInt(ownerId) }, data: { leftAt: new Date() } });
    const owners = (await ctx.http().get(`${base}/owners`).set(auth(token)).expect(200)).body;
    expect(owners.some((owner: { id: number }) => owner.id === ownerId)).toBe(false);
    await ctx.http().patch(`${base}/${row.id}`).set(auth(token)).send({ version: 1, ownerId, deployedVersion: 'v2', appUrl: '  ' }).expect(200);
    await ctx.http().post(base).set(auth(token)).send({ name: 'SIT', kind: 'sit', ownerId }).expect(422);
    await ctx.prisma.projectMember.updateMany({ where: { projectId: project.id, userId: BigInt(ownerId) }, data: { leftAt: null } });
    await ctx.prisma.user.update({ where: { id: BigInt(ownerId) }, data: { isActive: false } });
    expect((await ctx.http().get(`${base}/owners`).set(auth(token)).expect(200)).body.some((owner: { id: number }) => owner.id === ownerId)).toBe(false);
    await ctx.http().patch(`${base}/${row.id}`).set(auth(token)).send({ version: 2, ownerId, notes: 'Historical owner retained' }).expect(200);
  });
});
