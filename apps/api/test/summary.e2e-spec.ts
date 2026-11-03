import { auth, createTestApp, setupProject, TestCtx } from './helpers';

const api = (p: string) => `/api/v1${p}`;

describe('Project Bug summary', () => {
  let ctx: TestCtx;
  let t: Record<string, string>;
  const day = 86400_000;

  beforeAll(async () => {
    ctx = await createTestApp();
    ({ tokens: t } = await setupProject(ctx, 'ELMS', 'Mặc định', { developer: 'dev@x.test' }));
  });
  afterAll(() => ctx.close());

  it('defaults to open Bugs and aggregates Module, Epic, period, Function and Priority', async () => {
    const project = await ctx.prisma.project.findUniqueOrThrow({ where: { key: 'ELMS' } });
    const dev = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'dev@x.test' } });
    const statuses = await ctx.prisma.workflowStatus.findMany({ where: { projectId: project.id } });
    const openStatus = statuses.find((status) => status.category === 'todo') ?? statuses.find((status) => !['done', 'triage'].includes(status.category))!;
    const doneStatus = statuses.find((status) => status.category === 'done')!;
    const module = await ctx.prisma.projectModule.create({ data: { projectId: project.id, code: 'PAY', name: 'Payments' } });
    const fn = await ctx.prisma.requirement.create({ data: { projectId: project.id, kind: 'function', code: 'PAY-LOGIN', name: 'Payment login', rank: 'a', moduleId: module.id } });
    const epicIssue = await ctx.prisma.issue.create({ data: { projectId: project.id, number: 1n, type: 'epic', title: 'Payment Epic', statusId: openStatus.id, priority: 'medium', source: 'manual', rank: 'a' } });
    const period = await ctx.prisma.sprint.create({ data: { projectId: project.id, name: 'Phase Alpha', kind: 'phase', state: 'active' } });
    const createIssue = async (number: bigint, title: string, data: Record<string, unknown> = {}) => ctx.prisma.issue.create({ data: { projectId: project.id, number, type: 'bug', title, statusId: openStatus.id, priority: 'medium', source: 'manual', rank: `z${number}`, ...(data as any) } });
    const highest = await createIssue(2n, 'Highest unassigned', { priority: 'highest', parentId: epicIssue.id, sprintId: period.id });
    const assigned = await createIssue(3n, 'Assigned Bug', { assigneeId: dev.id });
    const unlinked = await createIssue(4n, 'Old unlinked Bug', { createdAt: new Date(Date.now() - 20 * day) });
    await createIssue(5n, 'Closed Bug', { statusId: doneStatus.id, resolvedAt: new Date() });
    await ctx.prisma.issue.create({ data: { projectId: project.id, number: 6n, type: 'task', title: 'Task excluded', statusId: openStatus.id, priority: 'highest', source: 'manual', rank: 'z6' } });
    await ctx.prisma.issueModule.createMany({ data: [{ issueId: highest.id, moduleId: module.id }, { issueId: assigned.id, moduleId: module.id }] });
    await ctx.prisma.issueFunction.create({ data: { issueId: highest.id, functionId: fn.id } });

    const summary = (await ctx.http().get(api('/projects/ELMS/summary')).set(auth(t.developer)).expect(200)).body;
    expect(summary.scope).toBe('open');
    expect(new Date(summary.createdLast7dFrom).toString()).not.toBe('Invalid Date');
    expect(summary.cards).toEqual({ total: 3, highest: 1, unassigned: 2, createdLast7d: 2 });
    expect(summary.statusOverview.total).toBe(3);
    expect(summary.byModule).toEqual(expect.arrayContaining([{ id: Number(module.id), label: 'PAY · Payments', count: 2 }, { id: null, label: 'Chưa gắn Module', count: 1 }]));
    expect(summary.byEpic).toEqual(expect.arrayContaining([{ id: Number(epicIssue.id), label: 'ELMS-1 · Payment Epic', count: 1 }, { id: null, label: 'Chưa gắn Epic', count: 2 }]));
    expect(summary.byPeriod).toEqual(expect.arrayContaining([{ id: Number(period.id), label: 'Phase Alpha', count: 1 }, { id: null, label: 'Chưa phân bổ', count: 2 }]));
    expect(summary.byFunction).toEqual(expect.arrayContaining([{ id: Number(fn.id), label: 'PAY-LOGIN · Payment login', count: 1 }, { id: null, label: 'Chưa gắn Function', count: 2 }]));
    expect(summary.byPriority).toEqual(expect.arrayContaining([{ priority: 'highest', count: 1 }, { priority: 'medium', count: 2 }]));

    const unlinkedKeys = async (query: string) => (await ctx.http().get(api(`/projects/ELMS/issues?type=bug&${query}`)).set(auth(t.developer)).expect(200)).body.items.map((item: any) => item.key);
    expect(await unlinkedKeys('moduleId=unassigned')).toEqual(expect.arrayContaining(['ELMS-4']));
    expect(await unlinkedKeys('moduleId=unassigned')).not.toContain('ELMS-2');
    expect(await unlinkedKeys('functionId=unassigned')).toEqual(expect.arrayContaining(['ELMS-3', 'ELMS-4']));
    expect(await unlinkedKeys('functionId=unassigned')).not.toContain('ELMS-2');
    expect(await unlinkedKeys('epicId=unassigned')).toEqual(expect.arrayContaining(['ELMS-3', 'ELMS-4']));
    expect(await unlinkedKeys('epicId=unassigned')).not.toContain('ELMS-2');
    expect(await unlinkedKeys(`createdAfter=${encodeURIComponent(summary.createdLast7dFrom)}`)).toEqual(expect.arrayContaining(['ELMS-2', 'ELMS-3']));

    await ctx.prisma.sprint.update({ where: { id: period.id }, data: { state: 'closed', completedAt: new Date() } });
    const historical = (await ctx.http().get(api(`/projects/ELMS/backlog?type=bug&includeAllPeriods=true&sprintId=${period.id}`)).set(auth(t.developer)).expect(200)).body;
    expect(historical.sprints[0].issues.map((item: any) => item.key)).toContain('ELMS-2');
    await ctx.http().get(api('/projects/ELMS/issues?createdFrom=2026-99-99')).set(auth(t.developer)).expect(400);

    const all = (await ctx.http().get(api('/projects/ELMS/summary?scope=all')).set(auth(t.developer)).expect(200)).body;
    expect(all.scope).toBe('all');
    expect(all.cards.total).toBe(4);
    const mine = (await ctx.http().get(api(`/projects/ELMS/summary?assigneeIds=${dev.id}`)).set(auth(t.developer)).expect(200)).body;
    expect(mine.cards.total).toBe(1);
    expect(mine.cards.unassigned).toBe(0);
    void unlinked;
  });

  it('dashboard aggregates across my projects and hides triage for non-testers', async () => {
    const d = (await ctx.http().get(api('/dashboard')).set(auth(t.developer)).expect(200)).body;
    expect(d.canTriage).toBe(false);
    expect(d.pendingReview).toEqual([]);
    expect(d.myWork[0].projectKey).toBe('ELMS');
    expect(d.cards.createdLast7d).toBeGreaterThan(0);
  });
});
