import ExcelJS from 'exceljs';
import { auth, createTestApp, createUser, login, setupProject, TestCtx } from './helpers';
import { ProjectImportService } from '../src/project-import/project-import.service';

describe('Project workbook import', () => {
  let ctx: TestCtx;
  let token: string;
  beforeAll(async () => {
    ctx = await createTestApp();
    token = (await setupProject(ctx, 'IMP', 'Có QA')).tokens.admin;
  });
  afterAll(async () => ctx.close());
  async function preview(sheets: Record<string, (string | number)[][]>, scope = 'backlog', actor = token) {
    const book = new ExcelJS.Workbook();
    for (const [name, rows] of Object.entries(sheets)) {
      const s = book.addWorksheet(name);
      rows.forEach((r) => s.addRow(r));
    }
    const response = await ctx
      .http()
      .post(`/api/v1/projects/IMP/imports/preview?scope=${scope}`)
      .set(auth(actor))
      .attach('file', Buffer.from(await book.xlsx.writeBuffer()), 'import.xlsx')
      .expect(202);
    const job = await ctx.http().get(`/api/v1/jobs/${response.body.jobId}`).set(auth(actor)).expect(200);
    expect(job.body.state).toBe('completed');
    return job.body.result;
  }
  async function commit(id: string) {
    const response = await ctx
      .http()
      .post(`/api/v1/projects/IMP/imports/${id}/commit`)
      .set(auth(token))
      .expect(202);
    return (await ctx.http().get(`/api/v1/jobs/${response.body.jobId}`).set(auth(token)).expect(200)).body;
  }
  it('previews without writes, resolves forward parents and optional Epic, commits once', async () => {
    const p = await preview({
      Modules: [
        ['code', 'name'],
        ['M', 'Module'],
      ],
      Functions: [
        ['code', 'name', 'moduleCode'],
        ['F', 'Function', 'M'],
      ],
      Backlog: [
        ['ref', 'title', 'type', 'parent', 'functionCodes'],
        ['child', 'Child', 'subtask', 'parent', ''],
        ['parent', 'Parent', 'task', '', 'F'],
      ],
    });
    expect(p.canCommit).toBe(true);
    expect(await ctx.prisma.issue.count({ where: { project: { key: 'IMP' } } })).toBe(0);
    const j = await commit(p.sessionId);
    expect(j.state).toBe('completed');
    expect(j.result.rows.filter((r: any) => r.itemKey)).toHaveLength(2);
    expect(await ctx.prisma.issue.count({ where: { project: { key: 'IMP' } } })).toBe(2);
    expect((await commit(p.sessionId)).result).toEqual(j.result);
  });
  it('collects errors and creates no entities', async () => {
    const p = await preview({
      Modules: [
        ['code', 'name'],
        ['BAD', ''],
      ],
      Backlog: [
        ['title', 'type', 'functionCodes'],
        ['Broken', 'task', 'MISSING'],
      ],
    });
    expect(p.canCommit).toBe(false);
    expect(p.errors.length).toBeGreaterThan(1);
    expect(await ctx.prisma.projectModule.count({ where: { code: 'BAD' } })).toBe(0);
    await ctx.http().post(`/api/v1/projects/IMP/imports/${p.sessionId}/commit`).set(auth(token)).expect(422);
  });
  it('rejects stale metadata before any write', async () => {
    const p = await preview({
      Modules: [
        ['code', 'name'],
        ['M', 'Rename'],
      ],
      Backlog: [['title'], ['Must roll back']],
    });
    await ctx.prisma.projectModule.updateMany({ where: { code: 'M' }, data: { name: 'Concurrent' } });
    const j = await commit(p.sessionId);
    expect(j.state).toBe('failed');
    expect(j.error).toMatch(/stale/i);
    expect(await ctx.prisma.issue.count({ where: { title: 'Must roll back' } })).toBe(0);
  });
  it('preserves blank updates and clears optional values explicitly', async () => {
    const p = await preview({
      Backlog: [
        ['title', 'description', 'estimateMinutes', 'dueDate', 'functionCodes'],
        ['Preserved', 'Details', 30, '2026-12-01', 'F'],
      ],
    });
    const result = (await commit(p.sessionId)).result;
    const key = result.rows[0].itemKey;
    const blank = await preview({
      Backlog: [
        ['itemKey', 'title', 'description', 'estimateMinutes', 'functionCodes'],
        [key, '', '', '', ''],
      ],
    });
    expect((await commit(blank.sessionId)).state).toBe('completed');
    let item = await ctx.prisma.issue.findFirstOrThrow({ where: { title: 'Preserved' } });
    expect(item.estimateMinutes).toBe(30);
    expect(item.description).toBeTruthy();
    const cleared = await preview({
      Backlog: [
        ['itemKey', 'title', 'description', 'estimateMinutes', 'dueDate', 'functionCodes'],
        [key, '', '[CLEAR]', '[CLEAR]', '[CLEAR]', '[CLEAR]'],
      ],
    });
    expect((await commit(cleared.sessionId)).state).toBe('completed');
    item = await ctx.prisma.issue.findUniqueOrThrow({ where: { id: item.id } });
    expect(item.title).toBe('Preserved');
    expect(item.description).toBeNull();
    expect(item.estimateMinutes).toBeNull();
    expect(item.dueDate).toBeNull();
    expect(await ctx.prisma.issueFunction.count({ where: { issueId: item.id } })).toBe(0);
  });
  it('keeps canonical Epics and explicit scope distinct from derived Module coverage', async () => {
    const p = await preview({
      Epics: [
        ['code', 'name', 'functionCodes'],
        ['E', 'Shared Epic', 'F'],
      ],
      Backlog: [
        ['ref', 'title', 'epicCode'],
        ['story', 'Under Epic', 'E'],
      ],
    });
    expect(p.canCommit).toBe(true);
    expect((await commit(p.sessionId)).state).toBe('completed');
    const e = await ctx.prisma.requirement.findFirstOrThrow({ where: { code: 'E' } });
    expect(e.epicIssueId).toBeTruthy();
    expect(await ctx.prisma.epicModule.count({ where: { epicId: e.id } })).toBe(0);
    expect(await ctx.prisma.requirementLink.count({ where: { epicId: e.id } })).toBe(1);
    expect((await ctx.prisma.issue.findFirstOrThrow({ where: { title: 'Under Epic' } })).parentId).toBe(
      e.epicIssueId,
    );
  });
  it('rejects duplicate identities, cycles, deleted identities and cross-project parents', async () => {
    const p = await preview({
      Modules: [
        ['code', 'name'],
        ['M', 'A'],
        ['M', 'B'],
      ],
      Backlog: [
        ['ref', 'title', 'type', 'parent'],
        ['a', 'A', 'task', 'b'],
        ['b', 'B', 'task', 'a'],
        ['cross', 'Cross', 'task', 'OTHER-1'],
      ],
    });
    expect(p.canCommit).toBe(false);
    expect(p.errors.map((e: any) => e.message).join(' ')).toMatch(
      /Duplicate code.*cycle.*Unknown|Duplicate code/i,
    );
    const project = await ctx.prisma.project.findUniqueOrThrow({ where: { key: 'IMP' } });
    await ctx.prisma.projectModule.create({
      data: { projectId: project.id, code: 'DELETED', name: 'Gone', deletedAt: new Date() },
    });
    const deleted = await preview(
      {
        Modules: [
          ['code', 'name'],
          ['DELETED', 'Restore'],
        ],
      },
      'structure',
    );
    expect(deleted.canCommit).toBe(false);
  });
  it('blocks another owner, project mismatch and expired previews', async () => {
    const member = await createUser(ctx, 'other-import@test.local', 'Other');
    const project = await ctx.prisma.project.findUniqueOrThrow({ where: { key: 'IMP' } });
    await ctx.prisma.projectMember.create({
      data: { projectId: project.id, userId: member.id, role: 'developer' },
    });
    const other = await login(ctx, member.email, 'Password1!');
    const p = await preview({ Backlog: [['title'], ['Owned preview']] });
    await ctx.http().post(`/api/v1/projects/IMP/imports/${p.sessionId}/commit`).set(auth(other)).expect(403);
    await setupProject(ctx, 'OTHER', 'Có QA');
    await ctx
      .http()
      .post(`/api/v1/projects/OTHER/imports/${p.sessionId}/commit`)
      .set(auth(token))
      .expect(404);
    await ctx.prisma.projectImportSession.update({
      where: { id: p.sessionId },
      data: { expiresAt: new Date(0) },
    });
    await ctx.http().post(`/api/v1/projects/IMP/imports/${p.sessionId}/commit`).set(auth(token)).expect(422);
  });
  it('requires explicit custom import grants and checks revocation on commit and job read', async () => {
    const project = await ctx.prisma.project.findUniqueOrThrow({ where: { key: 'IMP' } });
    const user = await createUser(ctx, 'restricted-import@test.local', 'Restricted');
    const role = await ctx.prisma.roleDefinition.create({
      data: {
        key: 'custom-import',
        name: 'Custom import',
        permissions: ['issue.view', 'issue.create', 'issue.edit'],
      },
    });
    await ctx.prisma.projectMember.create({
      data: { projectId: project.id, userId: user.id, role: 'developer', roleId: role.id },
    });
    const restricted = await login(ctx, user.email, 'Password1!');
    await ctx
      .http()
      .get('/api/v1/projects/IMP/imports/template?kind=backlog')
      .set(auth(restricted))
      .expect(403);
    await ctx.prisma.roleDefinition.update({
      where: { id: role.id },
      data: { permissions: ['issue.import'] },
    });
    const p = await preview({ Backlog: [['title'], ['Revoked preview']] }, 'backlog', restricted);
    await ctx.prisma.roleDefinition.update({ where: { id: role.id }, data: { permissions: ['issue.view'] } });
    await ctx
      .http()
      .post(`/api/v1/projects/IMP/imports/${p.sessionId}/commit`)
      .set(auth(restricted))
      .expect(403);
    const jobs = ctx.app.get(ProjectImportService);
    await expect(
      jobs.runCommit({
        projectId: String(project.id),
        userId: String(user.id),
        scope: 'backlog',
        sessionId: p.sessionId,
      }),
    ).rejects.toThrow(/permission/i);
    const book = new ExcelJS.Workbook();
    book.addWorksheet('Backlog').addRows([['title'], ['No grant']]);
    await ctx
      .http()
      .post('/api/v1/projects/IMP/imports/preview?scope=backlog')
      .set(auth(restricted))
      .attach('file', Buffer.from(await book.xlsx.writeBuffer()), 'test.xlsx')
      .expect(403);
  });
  it('requires structure permission for populated prerequisite sheets and transition permission for statuses', async () => {
    const project = await ctx.prisma.project.findUniqueOrThrow({ where: { key: 'IMP' } });
    const user = await ctx.prisma.user.findUniqueOrThrow({
      where: { email: 'restricted-import@test.local' },
    });
    await ctx.prisma.roleDefinition.update({
      where: { key: 'custom-import' },
      data: { permissions: ['issue.import'] },
    });
    const restricted = await login(ctx, user.email, 'Password1!');
    const statuses = await ctx.prisma.workflowStatus.findMany({ where: { projectId: project.id } });
    const settings = await ctx.prisma.workflowSettings.findUniqueOrThrow({
      where: { projectId: project.id },
    });
    const target = statuses.find((s) => s.id !== settings.initialManualStatusId)!;
    const p = await preview(
      {
        Backlog: [
          ['title', 'status'],
          ['Cannot transition', target.name],
        ],
      },
      'backlog',
      restricted,
    );
    expect(p.canCommit).toBe(false);
    expect(p.errors.some((e: any) => e.message.includes('issue.transition'))).toBe(true);
    const book = new ExcelJS.Workbook();
    book.addWorksheet('Modules').addRows([
      ['code', 'name'],
      ['UNAUTHORIZED', 'No'],
    ]);
    book.addWorksheet('Backlog').addRows([['title'], ['No']]);
    const response = await ctx
      .http()
      .post('/api/v1/projects/IMP/imports/preview?scope=backlog')
      .set(auth(restricted))
      .attach('file', Buffer.from(await book.xlsx.writeBuffer()), 'test.xlsx')
      .expect(202);
    const job = await ctx.http().get(`/api/v1/jobs/${response.body.jobId}`).set(auth(restricted)).expect(200);
    expect(job.body.state).toBe('failed');
    expect(await ctx.prisma.projectModule.count({ where: { code: 'UNAUTHORIZED' } })).toBe(0);
  });
  it('rejects closed, wrong-mode, ambiguous periods and inactive assignees', async () => {
    const project = await ctx.prisma.project.findUniqueOrThrow({ where: { key: 'IMP' } });
    await ctx.prisma.sprint.createMany({
      data: [
        { projectId: project.id, name: 'Closed', state: 'closed' },
        { projectId: project.id, name: 'Phase only', kind: 'phase' },
        { projectId: project.id, name: 'Ambiguous' },
        { projectId: project.id, name: 'Ambiguous' },
      ],
    });
    const p = await preview({
      Backlog: [
        ['title', 'period', 'assignee'],
        ['Closed', 'Closed', ''],
        ['Wrong mode', 'Phase only', ''],
        ['Ambiguous', 'Ambiguous', ''],
        ['Inactive', '', 'unknown@test.local'],
      ],
    });
    expect(p.canCommit).toBe(false);
    expect(p.rows.every((r: any) => r.action === 'error')).toBe(true);
  });
  it('returns one durable result for concurrent commits', async () => {
    const p = await preview({ Backlog: [['title'], ['Concurrent once']] });
    const outcomes = await Promise.all([commit(p.sessionId), commit(p.sessionId)]);
    expect(outcomes.every((j) => j.state === 'completed')).toBe(true);
    expect(outcomes[0].result).toEqual(outcomes[1].result);
    expect(await ctx.prisma.issue.count({ where: { title: 'Concurrent once' } })).toBe(1);
  });
  it('rejects contradictory explicit relationships in either sheet order', async () => {
    for (const reverse of [false, true]) {
      const entries: [string, (string | number)[][]][] = [
        [
          'Epics',
          [
            ['code', 'name', 'functionCodes'],
            ['E', '', '[CLEAR]'],
          ],
        ],
        [
          'Functions',
          [
            ['code', 'name', 'epicCodes'],
            ['F', '', 'E'],
          ],
        ],
        ['Backlog', [['title'], ['Contradiction']]],
      ];
      const p = await preview(Object.fromEntries(reverse ? entries.reverse() : entries));
      expect(p.canCommit).toBe(false);
      expect(p.errors.some((e: any) => /Conflicting/.test(e.message))).toBe(true);
    }
    const parent = await preview({
      Backlog: [
        ['title', 'parent', 'epicCode'],
        ['Ambiguous parent', '[CLEAR]', 'E'],
      ],
    });
    expect(parent.canCommit).toBe(false);
  });
  it('updates Done and reopen resolution fields and rejects stale tracking modes', async () => {
    const project = await ctx.prisma.project.findUniqueOrThrow({ where: { key: 'IMP' } });
    const statuses = await ctx.prisma.workflowStatus.findMany({ where: { projectId: project.id } }),
      done = statuses.find((s) => s.category === 'done')!,
      todo = statuses.find((s) => s.category === 'todo')!;
    const p = await preview({
      Backlog: [
        ['title', 'status'],
        ['Resolved import', done.name],
      ],
    });
    const key = (await commit(p.sessionId)).result.rows[0].itemKey;
    let item = await ctx.prisma.issue.findFirstOrThrow({ where: { title: 'Resolved import' } });
    expect(item.resolution).toBe('done');
    expect(item.resolvedAt).toBeTruthy();
    const reopen = await preview({
      Backlog: [
        ['itemKey', 'title', 'status'],
        [key, '', todo.name],
      ],
    });
    expect((await commit(reopen.sessionId)).state).toBe('completed');
    item = await ctx.prisma.issue.findUniqueOrThrow({ where: { id: item.id } });
    expect(item.resolution).toBeNull();
    expect(item.resolvedAt).toBeNull();
    const stale = await preview({ Backlog: [['title'], ['Mode changed']] });
    await ctx.prisma.project.update({ where: { id: project.id }, data: { trackingMode: 'phase' } });
    expect((await commit(stale.sessionId)).error).toMatch(/stale/i);
    await ctx.prisma.project.update({ where: { id: project.id }, data: { trackingMode: 'sprint' } });
  });
  it('uses current-mode period when another mode has the same name', async () => {
    const project = await ctx.prisma.project.findUniqueOrThrow({ where: { key: 'IMP' } });
    await ctx.prisma.sprint.create({ data: { projectId: project.id, name: 'Shared period', kind: 'phase' } });
    const sprint = await ctx.prisma.sprint.create({
      data: { projectId: project.id, name: 'Shared period', kind: 'sprint' },
    });
    const p = await preview({
      Backlog: [
        ['title', 'period'],
        ['Correct period', 'Shared period'],
      ],
    });
    expect((await commit(p.sessionId)).state).toBe('completed');
    expect((await ctx.prisma.issue.findFirstOrThrow({ where: { title: 'Correct period' } })).sprintId).toBe(
      sprint.id,
    );
  });
  it('rechecks workflow graph and triage rules without bypass', async () => {
    const project = await ctx.prisma.project.findUniqueOrThrow({ where: { key: 'IMP' } });
    const restricted = await login(ctx, 'restricted-import@test.local', 'Password1!');
    await ctx.prisma.roleDefinition.update({
      where: { key: 'custom-import' },
      data: { permissions: ['issue.import', 'issue.transition'] },
    });
    const statuses = await ctx.prisma.workflowStatus.findMany({ where: { projectId: project.id } }),
      triage = statuses.find((s) => s.category === 'triage')!,
      done = statuses.find((s) => s.category === 'done')!;
    const created = await preview({
      Backlog: [
        ['title', 'status'],
        ['Triage import', triage.name],
      ],
    });
    const key = (await commit(created.sessionId)).result.rows[0].itemKey;
    const p = await preview(
      {
        Backlog: [
          ['itemKey', 'status', 'period'],
          [key, done.name, 'Shared period'],
        ],
      },
      'backlog',
      restricted,
    );
    expect(p.canCommit).toBe(false);
    expect(p.errors.some((e: any) => /Triage/.test(e.message))).toBe(true);
  });
  it('enforces job read ownership and current permissions', async () => {
    const restricted = await login(ctx, 'restricted-import@test.local', 'Password1!');
    const book = new ExcelJS.Workbook();
    book.addWorksheet('Backlog').addRows([['title'], ['Read permissions']]);
    const response = await ctx
      .http()
      .post('/api/v1/projects/IMP/imports/preview?scope=backlog')
      .set(auth(restricted))
      .attach('file', Buffer.from(await book.xlsx.writeBuffer()), 'test.xlsx')
      .expect(202);
    await ctx.http().get(`/api/v1/jobs/${response.body.jobId}`).set(auth(token)).expect(403);
    await ctx.prisma.roleDefinition.update({ where: { key: 'custom-import' }, data: { permissions: [] } });
    await ctx.http().get(`/api/v1/jobs/${response.body.jobId}`).set(auth(restricted)).expect(403);
  });
  it('resolves references beyond paged API limits', async () => {
    const project = await ctx.prisma.project.findUniqueOrThrow({ where: { key: 'IMP' } });
    await ctx.prisma.projectModule.createMany({
      data: Array.from({ length: 205 }, (_, i) => ({
        projectId: project.id,
        code: `LOOKUP-${i}`,
        name: `Module ${i}`,
      })),
    });
    const p = await preview({
      Backlog: [
        ['title', 'moduleCodes'],
        ['Last module', 'LOOKUP-204'],
      ],
    });
    expect(p.canCommit).toBe(true);
    expect((await commit(p.sessionId)).state).toBe('completed');
  });
  it('rolls back all writes and the durable result if a late write fails', async () => {
    const p = await preview({
      Modules: [
        ['code', 'name'],
        ['ROLLBACK-M', 'Must roll back'],
      ],
      Backlog: [['title'], ['Rollback item']],
    });
    const service = ctx.app.get(ProjectImportService);
    const original = (service as any).apply.bind(service);
    const spy = jest.spyOn(service as any, 'apply').mockImplementation(async (...args: any[]) => {
      await original(...args);
      throw new Error('Forced late write failure');
    });
    try {
      expect((await commit(p.sessionId)).state).toBe('failed');
    } finally {
      spy.mockRestore();
    }
    expect(await ctx.prisma.projectModule.count({ where: { code: 'ROLLBACK-M' } })).toBe(0);
    expect(await ctx.prisma.issue.count({ where: { title: 'Rollback item' } })).toBe(0);
    expect(
      (await ctx.prisma.projectImportSession.findUniqueOrThrow({ where: { id: p.sessionId } })).result,
    ).toBeNull();
    expect((await commit(p.sessionId)).state).toBe('completed');
  });
  it('invalidates shared Epic versions when metadata relation scopes change', async () => {
    const epic = await ctx.prisma.requirement.findFirstOrThrow({ where: { code: 'E' } });
    const before = await ctx.prisma.issue.findUniqueOrThrow({ where: { id: epic.epicIssueId! } });
    const p = await preview(
      {
        Epics: [
          ['code', 'name', 'moduleCodes'],
          ['E', '', 'M'],
        ],
      },
      'structure',
    );
    expect((await commit(p.sessionId)).state).toBe('completed');
    expect((await ctx.prisma.issue.findUniqueOrThrow({ where: { id: before.id } })).version).toBeGreaterThan(
      before.version,
    );
  });
  it('denies status-import polling after transition permission is revoked', async () => {
    const role = await ctx.prisma.roleDefinition.findUniqueOrThrow({ where: { key: 'custom-import' } });
    await ctx.prisma.roleDefinition.update({
      where: { id: role.id },
      data: { permissions: ['issue.import', 'issue.transition', 'workflow.bypass'] },
    });
    const restricted = await login(ctx, 'restricted-import@test.local', 'Password1!');
    const project = await ctx.prisma.project.findUniqueOrThrow({ where: { key: 'IMP' } });
    const done = await ctx.prisma.workflowStatus.findFirstOrThrow({
      where: { projectId: project.id, category: 'done' },
    });
    const book = new ExcelJS.Workbook();
    book.addWorksheet('Backlog').addRows([
      ['title', 'status'],
      ['Permission snapshot', done.name],
    ]);
    const response = await ctx
      .http()
      .post('/api/v1/projects/IMP/imports/preview?scope=backlog')
      .set(auth(restricted))
      .attach('file', Buffer.from(await book.xlsx.writeBuffer()), 'test.xlsx')
      .expect(202);
    const job = await ctx.http().get(`/api/v1/jobs/${response.body.jobId}`).set(auth(restricted)).expect(200);
    expect(job.body.result.canCommit).toBe(true);
    await ctx.prisma.roleDefinition.update({
      where: { id: role.id },
      data: { permissions: ['issue.import'] },
    });
    await ctx.http().get(`/api/v1/jobs/${response.body.jobId}`).set(auth(restricted)).expect(403);
    await ctx
      .http()
      .post(`/api/v1/projects/IMP/imports/${job.body.result.sessionId}/commit`)
      .set(auth(restricted))
      .expect(403);
  });
});
