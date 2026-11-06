import { auth, createTestApp, createUser, login, setupProject, TestCtx } from './helpers';
import { contributorRange } from '../src/summary/bug-contributors';

describe('Bug contributors', () => {
  let ctx: TestCtx;
  let tokens: Record<string, string>;
  let reporters: bigint[];

  beforeAll(async () => {
    ctx = await createTestApp();
    ({ tokens } = await setupProject(ctx, 'HNR', 'Mặc định', { admin: 'admin@honors.test', tester: 'tester@honors.test', developer: 'dev@honors.test', viewer: 'viewer@honors.test' }));
    const project = await ctx.prisma.project.findUniqueOrThrow({ where: { key: 'HNR' } });
    reporters = await Promise.all(['admin', 'tester', 'dev'].map(async (name) => (await ctx.prisma.user.findUniqueOrThrow({ where: { email: `${name}@honors.test` } })).id));
    const settings = await ctx.prisma.workflowSettings.findUniqueOrThrow({ where: { projectId: project.id } });
    const statuses = await ctx.prisma.workflowStatus.findMany({ where: { projectId: project.id } });
    const done = statuses.find((s) => s.category === 'done' && s.id !== settings.rejectStatusId)!;
    const add = (number: number, reporterId: bigint | null, createdAt: string, extra: Record<string, unknown> = {}) => ctx.prisma.issue.create({ data: {
      projectId: project.id, number: BigInt(number), type: 'bug', title: `Bug ${number}`, statusId: settings.initialManualStatusId,
      rank: `a${number}`, reporterId, createdAt: new Date(createdAt), ...extra,
    } as any });
    const original = await add(1, reporters[0], '2026-11-01T17:00:00Z');
    await add(2, reporters[0], '2026-11-08T16:59:59.999Z', { statusId: done.id });
    await add(3, reporters[1], '2026-11-04T00:00:00Z');
    await add(4, reporters[1], '2026-11-05T00:00:00Z');
    await add(5, reporters[2], '2026-11-05T00:00:00Z');
    await add(6, reporters[0], '2026-11-05T00:00:00Z', { resolution: 'duplicate', duplicateOfId: original.id });
    await add(7, reporters[0], '2026-11-05T00:00:00Z', { resolution: 'rejected' });
    await add(8, reporters[0], '2026-11-05T00:00:00Z', { source: 'auto' });
    await add(9, reporters[0], '2026-11-05T00:00:00Z', { deletedAt: new Date() });
    await add(10, reporters[0], '2026-11-05T00:00:00Z', { type: 'task' });
    await add(11, null, '2026-11-05T00:00:00Z');
    await add(12, reporters[0], '2026-11-05T00:00:00Z', { duplicateOfId: original.id });
    await add(13, reporters[0], '2026-11-01T16:59:59.999Z');
    await add(14, reporters[0], '2026-11-08T17:00:00Z');
    if (settings.rejectStatusId) await add(15, reporters[0], '2026-11-05T00:00:00Z', { statusId: settings.rejectStatusId });
    await add(16, reporters[0], '2026-11-05T00:00:00Z', { statusId: settings.initialAutoStatusId });
    await add(17, reporters[1], '2026-11-05T00:00:00Z', { resolution: 'rejected' });
    await add(18, reporters[0], '2026-11-05T00:00:00Z', { resolution: 'rejected', source: 'auto' });
    await add(19, reporters[0], '2026-11-05T00:00:00Z', { resolution: 'rejected', deletedAt: new Date() });
    await add(20, reporters[0], '2026-11-05T00:00:00Z', { resolution: 'rejected', duplicateOfId: original.id });
    await add(21, reporters[0], '2026-11-08T17:00:00Z', { resolution: 'rejected' });
    const other = (await setupProject(ctx, 'OTHER', 'Mặc định')).project;
    const otherSettings = await ctx.prisma.workflowSettings.findUniqueOrThrow({ where: { projectId: BigInt(other.id) } });
    await ctx.prisma.issue.create({ data: { projectId: BigInt(other.id), number: 1n, type: 'bug', title: 'Other project', statusId: otherSettings.initialManualStatusId, reporterId: reporters[0], rank: 'a', createdAt: new Date('2026-11-05T00:00:00Z') } });
  });
  afterAll(async () => { await ctx?.close(); });

  it('ranks valid manual bugs in a Vietnam calendar week, including closed bugs and ties', async () => {
    const { body } = await ctx.http().get('/api/v1/projects/HNR/bug-contributors?period=week&date=2026-11-05').set(auth(tokens.viewer)).expect(200);
    expect(body).toMatchObject({ period: 'week', from: '2026-11-01T17:00:00.000Z', to: '2026-11-08T17:00:00.000Z', total: 5 });
    expect(body.items.map((r: any) => [r.user.id, r.count, r.rank])).toEqual([[Number(reporters[0]), 2, 1], [Number(reporters[1]), 2, 1], [Number(reporters[2]), 1, 3]]);
  });

  it('uses month and year boundaries, excludes the next period and returns empty periods', async () => {
    const november = (await ctx.http().get('/api/v1/projects/HNR/bug-contributors?period=month&date=2026-11-05').set(auth(tokens.viewer)).expect(200)).body;
    expect(november).toMatchObject({ from: '2026-10-31T17:00:00.000Z', to: '2026-11-30T17:00:00.000Z', total: 7 });
    const december = (await ctx.http().get('/api/v1/projects/HNR/bug-contributors?period=month&date=2026-12-31').set(auth(tokens.viewer)).expect(200)).body;
    expect(december).toMatchObject({ from: '2026-11-30T17:00:00.000Z', to: '2026-12-31T17:00:00.000Z', total: 0, items: [] });
    const sunday = (await ctx.http().get('/api/v1/projects/HNR/bug-contributors?period=week&date=2026-11-08').set(auth(tokens.viewer)).expect(200)).body;
    expect(sunday.total).toBe(5);
  });

  it('keeps rejected manual bug reminders separate from valid contribution scores', async () => {
    const { body } = await ctx.http().get('/api/v1/projects/HNR/bug-contributors?period=week&date=2026-11-05').set(auth(tokens.viewer)).expect(200);
    expect(body.total).toBe(5);
    expect(body.rejected.total).toBe(3);
    expect(body.rejected.items.map((row: any) => [row.user.id, row.count])).toEqual([[Number(reporters[0]), 2], [Number(reporters[1]), 1]]);
    const empty = (await ctx.http().get('/api/v1/projects/HNR/bug-contributors?period=month&date=2026-12-01').set(auth(tokens.viewer)).expect(200)).body;
    expect(empty.rejected).toEqual({ total: 0, items: [] });
  });

  it('reports by reporter and drills into only that reporter’s bugs', async () => {
    const { body } = await ctx.http().get('/api/v1/projects/HNR/summary?scope=all').set(auth(tokens.viewer)).expect(200);
    expect(body.bugReport.byReporter).toEqual(expect.arrayContaining([expect.objectContaining({ id: Number(reporters[1]), label: 'TESTER', count: 3 }), expect.objectContaining({ id: null, count: 1 })]));
    const issues = (await ctx.http().get(`/api/v1/projects/HNR/issues?type=bug&reporterId=${reporters[1]}`).set(auth(tokens.viewer)).expect(200)).body;
    expect(issues.items.map((i: any) => i.key).sort()).toEqual(['HNR-17', 'HNR-3', 'HNR-4']);
  });

  it('validates input and prevents anonymous/non-member access', async () => {
    await ctx.http().get('/api/v1/projects/HNR/bug-contributors?period=day').set(auth(tokens.viewer)).expect(400);
    await ctx.http().get('/api/v1/projects/HNR/bug-contributors?date=2026-02-30').set(auth(tokens.viewer)).expect(400);
    await ctx.http().get('/api/v1/projects/HNR/bug-contributors').expect(401);
    await createUser(ctx, 'outsider@honors.test', 'Outsider');
    const token = await login(ctx, 'outsider@honors.test', 'Password1!');
    await ctx.http().get('/api/v1/projects/HNR/bug-contributors').set(auth(token)).expect(403);
  });

  it('handles leap months, year-crossing weeks and the default Vietnam calendar day', () => {
    const leap = contributorRange('month', '2024-02-29');
    expect(leap.from.toISOString()).toBe('2024-01-31T17:00:00.000Z');
    expect(leap.to.toISOString()).toBe('2024-02-29T17:00:00.000Z');
    const newYear = contributorRange('week', '2027-01-01');
    expect(newYear.from.toISOString()).toBe('2026-12-27T17:00:00.000Z');
    expect(newYear.to.toISOString()).toBe('2027-01-03T17:00:00.000Z');
    const defaultMonth = contributorRange('month', undefined, new Date('2026-10-31T18:00:00Z'));
    expect(defaultMonth.from.toISOString()).toBe('2026-10-31T17:00:00.000Z');
  });
});
