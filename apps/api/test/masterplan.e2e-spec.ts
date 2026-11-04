import { auth, createTestApp, setupProject, TestCtx } from './helpers';

describe('Project Masterplan', () => {
  let ctx: TestCtx; let admin: string; let viewer: string; let projectId: bigint; let featureId: number; let ownerId: number;
  const base = '/api/v1/projects/PLAN/masterplan';
  beforeAll(async () => {
    ctx = await createTestApp();
    const setup = await setupProject(ctx, 'PLAN', 'Tối giản', { viewer: 'plan-viewer@test.local' });
    admin = setup.tokens.admin; viewer = setup.tokens.viewer; projectId = BigInt(setup.project.id);
    ownerId = Number((await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'plan-viewer@test.local' } })).id);
    featureId = Number((await ctx.prisma.requirement.create({ data: { projectId, code: 'LOGIN', name: 'Login', kind: 'function', rank: 'a' } })).id);
    await setupProject(ctx, 'PLANOTHER', 'Tối giản');
  });
  afterAll(async () => { if (ctx) await ctx.close(); });

  it('creates, reads, updates and removes milestones without changing features', async () => {
    const payload = { name: 'First delivery', startDate: '2026-11-04', endDate: '2026-11-30', ownerId, featureIds: [featureId], acceptanceCriteria: 'Login tests pass', status: 'planned', progress: 0 };
    const row = (await ctx.http().post(base).set(auth(admin)).send(payload).expect(201)).body;
    expect(row).toMatchObject({ name: payload.name, version: 1, progress: 0, owner: { id: ownerId }, features: [{ id: featureId, code: 'LOGIN' }] });
    expect(row.startDate.slice(0, 10)).toBe('2026-11-04');
    expect((await ctx.http().get(base).set(auth(viewer)).expect(200)).body).toHaveLength(1);
    expect((await ctx.http().get(`${base}/options`).set(auth(admin)).expect(200)).body.features).toEqual(expect.arrayContaining([expect.objectContaining({ id: featureId })]));
    await ctx.http().patch(`${base}/${row.id}`).set(auth(admin)).send({ ...payload, version: 1, status: 'in_progress', progress: 40 }).expect(200);
    await ctx.http().patch(`${base}/${row.id}`).set(auth(admin)).send({ ...payload, version: 1 }).expect(409);
    await ctx.http().delete(`${base}/${row.id}?version=1`).set(auth(admin)).expect(409);
    await ctx.http().delete(`${base}/${row.id}?version=2`).set(auth(admin)).expect(204);
    expect((await ctx.http().get(base).set(auth(admin))).body).toHaveLength(0);
    expect(await ctx.prisma.requirement.count({ where: { id: BigInt(featureId) } })).toBe(1);
  });

  it('validates dates, progress, references and project isolation', async () => {
    await ctx.http().post(base).set(auth(admin)).send({ name: 'Bad dates', startDate: '2026-11-30', endDate: '2026-11-04' }).expect(400);
    await ctx.http().post(base).set(auth(admin)).send({ name: 'Bad date', startDate: '2026-02-30' }).expect(400);
    await ctx.http().post(base).set(auth(admin)).send({ name: 'Bad progress', progress: 101 }).expect(400);
    await ctx.http().post(base).set(auth(admin)).send({ name: 'Null features', featureIds: null }).expect(400);
    await ctx.http().post(base).set(auth(admin)).send({ name: 'Missing feature', featureIds: [999999] }).expect(422);
    await ctx.http().post(base).set(auth(admin)).send({ name: 'Missing owner', ownerId: 999999 }).expect(422);
    const row = (await ctx.http().post(base).set(auth(admin)).send({ name: 'Scoped' }).expect(201)).body;
    await ctx.http().patch(`/api/v1/projects/PLANOTHER/masterplan/${row.id}`).set(auth(admin)).send({ name: 'Wrong project', version: 1 }).expect(404);
    await ctx.http().delete(`/api/v1/projects/PLANOTHER/masterplan/${row.id}?version=1`).set(auth(admin)).expect(404);
    await ctx.http().post(base).set(auth(viewer)).send({ name: 'Forbidden' }).expect(403);
    await ctx.http().patch(`${base}/${row.id}`).set(auth(viewer)).send({ name: 'Forbidden', version: 1 }).expect(403);
    await ctx.http().patch(`${base}/${row.id}`).set(auth(admin)).send({ name: 'Null features', version: 1, featureIds: null }).expect(400);
    await ctx.http().delete(`${base}/${row.id}?version=1`).set(auth(viewer)).expect(403);
    const other = await ctx.prisma.project.findUniqueOrThrow({ where: { key: 'PLANOTHER' } });
    const feature = await ctx.prisma.requirement.create({ data: { projectId: other.id, code: 'OTHER', name: 'Other project feature', kind: 'function', rank: 'a' } });
    await ctx.http().patch(`${base}/${row.id}`).set(auth(admin)).send({ name: 'Scoped', version: 1, featureIds: [Number(feature.id)] }).expect(422);
  });
  it('preserves historical feature links on unrelated edits without allowing new deleted links', async () => {
    const row = (await ctx.http().post(base).set(auth(admin)).send({ name: 'Historical', featureIds: [featureId] }).expect(201)).body;
    await ctx.prisma.requirement.update({ where: { id: BigInt(featureId) }, data: { deletedAt: new Date() } });
    const edited = (await ctx.http().patch(`${base}/${row.id}`).set(auth(admin)).send({ name: 'Historical', version: 1, progress: 50, featureIds: [featureId] }).expect(200)).body;
    expect(edited.progress).toBe(50);
    expect(edited.features[0].id).toBe(featureId);
    await ctx.http().post(base).set(auth(admin)).send({ name: 'New deleted link', featureIds: [featureId] }).expect(422);
  });
});
