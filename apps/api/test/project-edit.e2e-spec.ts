import { auth, createTestApp, setupProject, templateId, TestCtx } from './helpers';

describe('Edit projects and dates', () => {
  let ctx: TestCtx;
  let tokens: Record<string, string>;

  beforeAll(async () => {
    ctx = await createTestApp();
    ({ tokens } = await setupProject(ctx, 'DATES', 'Tối giản', { developer: 'dates-dev@x.test', viewer: 'dates-viewer@x.test', admin: 'dates-admin@x.test' }));
  });
  afterAll(async () => { await ctx?.close(); });
  const patch = (body: object, token?: string) => ctx.http().patch('/api/v1/projects/DATES').set(auth(token ?? tokens.admin)).send(body);

  it('creates a project with optional date-only values and exposes them in list/detail', async () => {
    // A project admin is not a system admin; use the seeded system admin for creation.
    const { login, ADMIN } = await import('./helpers');
    const systemAdmin = await login(ctx, ADMIN.email, ADMIN.password);
    const res = await ctx.http().post('/api/v1/projects').set(auth(systemAdmin)).send({
      key: 'NEW', name: 'New dated project', workflowTemplateId: await templateId(ctx, 'Tối giản'),
      startDate: '2026-11-01', endDate: '2026-11-30',
    }).expect(201);
    expect(res.body.startDate?.slice(0, 10)).toBe('2026-11-01');
    expect(res.body.endDate?.slice(0, 10)).toBe('2026-11-30');
    const detail = await ctx.http().get('/api/v1/projects/NEW').set(auth(systemAdmin)).expect(200);
    expect(detail.body.startDate?.slice(0, 10)).toBe('2026-11-01');
    const list = await ctx.http().get('/api/v1/projects').set(auth(systemAdmin)).expect(200);
    expect(list.body.find((p: any) => p.key === 'NEW').endDate?.slice(0, 10)).toBe('2026-11-30');
  });

  it('lets project admins update name, description, lead and dates', async () => {
    const lead = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'dates-dev@x.test' } });
    const res = await patch({ name: 'Updated project', description: 'Updated description', leadId: Number(lead.id), startDate: '2026-11-01', endDate: '2026-11-30' }).expect(200);
    expect(res.body).toMatchObject({ name: 'Updated project', description: 'Updated description', leadId: Number(lead.id) });
    const stored = await ctx.prisma.project.findUniqueOrThrow({ where: { key: 'DATES' } });
    expect((stored as any).startDate?.toISOString().slice(0, 10)).toBe('2026-11-01');
  });

  it.each([{ startDate: '2026-12-01' }, { endDate: '2026-10-31' }, { startDate: '2027-01-01', endDate: '2026-01-01' }])('rejects invalid merged date range %j without saving', async (body) => {
    await patch(body).expect(400);
    const res = await ctx.http().get('/api/v1/projects/DATES').set(auth(tokens.admin)).expect(200);
    expect(res.body.startDate?.slice(0, 10)).toBe('2026-11-01');
    expect(res.body.endDate?.slice(0, 10)).toBe('2026-11-30');
  });

  it.each(['2026-02-30', '2026-13-01', 'not-a-date', '2026-11-01T00:00:00Z', ''])('rejects invalid date %s', async (startDate) => {
    await patch({ startDate }).expect(400);
  });

  it('preserves omitted dates, allows equal dates and clears dates/lead explicitly', async () => {
    const unchanged = await patch({ name: 'Another name' }).expect(200);
    expect(unchanged.body.endDate?.slice(0, 10)).toBe('2026-11-30');
    await patch({ startDate: '2026-11-30' }).expect(200);
    const cleared = await patch({ startDate: null, endDate: null, leadId: null }).expect(200);
    expect(cleared.body).toMatchObject({ startDate: null, endDate: null, leadId: null });
    await patch({ endDate: '2026-10-01' }).expect(200);
  });

  it('rejects a missing lead with 404 and preserves the project name', async () => {
    await patch({ leadId: 999999, name: 'Must not save' }).expect(404);
    expect((await ctx.prisma.project.findUniqueOrThrow({ where: { key: 'DATES' } })).name).toBe('Another name');
  });

  it.each(['developer', 'viewer'])('prevents %s from editing projects', async (role) => {
    await patch({ name: 'Denied' }, tokens[role]).expect(403);
  });

  it('rejects reversed dates on creation', async () => {
    const { login, ADMIN } = await import('./helpers');
    const token = await login(ctx, ADMIN.email, ADMIN.password);
    await ctx.http().post('/api/v1/projects').set(auth(token)).send({
      key: 'BAD', name: 'Invalid range', workflowTemplateId: await templateId(ctx, 'Tối giản'),
      startDate: '2026-12-01', endDate: '2026-11-01',
    }).expect(400);
    expect(await ctx.prisma.project.count({ where: { key: 'BAD' } })).toBe(0);
  });
});
