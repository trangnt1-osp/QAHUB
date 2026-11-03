import { auth, createTestApp, setupProject, TestCtx } from './helpers';
import { randomUUID } from 'node:crypto';

describe('Project-scoped configurable roles', () => {
  let ctx: TestCtx;
  let admin: string;
  let qcToken: string;
  let qcId: number;
  let roleId: number;
  let functionId: number;
  let testCaseId: number;
  const api = '/api/v1';
  const setPermissions = (permissions: string[]) => ctx.http().patch(`${api}/roles/${roleId}`).set(auth(admin)).send({ permissions });
  beforeAll(async () => {
    ctx = await createTestApp();
    const first = await setupProject(ctx, 'RBACA', 'Tối giản', { viewer: 'qc-rbac@x.test' });
    admin = first.tokens.admin;
    qcToken = first.tokens.viewer;
    qcId = Number((await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'qc-rbac@x.test' } })).id);
    await setupProject(ctx, 'RBACB', 'Tối giản');
    await ctx.http().post(`${api}/projects/RBACB/members`).set(auth(admin)).send({ userId: qcId, role: 'developer' }).expect(201);
    const roles = await ctx.http().get(`${api}/roles`).set(auth(admin)).expect(200);
    roleId = roles.body.find((role: any) => role.key === 'qc').id;
    await ctx.http().patch(`${api}/projects/RBACA/members/${qcId}`).set(auth(admin)).send({ roleId }).expect(200);
    const fn = await ctx.http().post(`${api}/projects/RBACA/requirements`).set(auth(admin)).send({ kind: 'function', code: 'FN-RBAC', name: 'RBAC function' }).expect(201);
    functionId = fn.body.id;
  });
  afterAll(async () => { await ctx?.close(); });

  it('returns effective permissions per project without changing builtin assignments', async () => {
    const me = await ctx.http().get(`${api}/auth/me`).set(auth(qcToken)).expect(200);
    expect(me.body.projects.find((p: any) => p.projectKey === 'RBACA')).toMatchObject({ roleId, roleName: 'QC', permissions: expect.arrayContaining(['project.info.view', 'project.backlog.view', 'testcase.view']) });
    expect(me.body.projects.find((p: any) => p.projectKey === 'RBACB')).toMatchObject({ role: 'developer', roleId: null });
  });

  it('allows configured read sections but denies configuration and all ungranted writes', async () => {
    for (const path of ['projects/RBACA', 'projects/RBACA/backlog', 'projects/RBACA/board', 'projects/RBACA/test-cases', 'projects/RBACA/workflow/runtime']) await ctx.http().get(`${api}/${path}`).set(auth(qcToken)).expect(200);
    await ctx.http().get(`${api}/projects/RBACA/workflow`).set(auth(qcToken)).expect(403);
    await ctx.http().get(`${api}/projects/RBACA/api-keys`).set(auth(qcToken)).expect(403);
    await ctx.http().get(`${api}/projects/RBACA/members`).set(auth(qcToken)).expect(403);
    const options = await ctx.http().get(`${api}/projects/RBACA/members/options`).set(auth(qcToken)).expect(200);
    expect(options.body[0].role).toBeUndefined();
    expect(options.body[0].user.email).toBeUndefined();
    await ctx.http().patch(`${api}/projects/RBACA`).set(auth(qcToken)).send({ name: 'Forbidden' }).expect(403);
    await ctx.http().post(`${api}/projects/RBACA/sprints`).set(auth(qcToken)).send({}).expect(403);
    await ctx.http().post(`${api}/projects/RBACA/issues`).set(auth(qcToken)).send({ type: 'task', title: 'Denied' }).expect(403);
    await ctx.http().post(`${api}/projects/RBACA/test-cases`).set(auth(qcToken)).send({ functionId, title: 'Denied' }).expect(403);
  });

  it('normalizes prerequisites and applies role edits to an existing token immediately', async () => {
    const role = await setPermissions(['testcase.create']).expect(200);
    expect(role.body.permissions).toEqual(expect.arrayContaining(['project.view', 'testcase.view', 'testcase.create']));
    const created = await ctx.http().post(`${api}/projects/RBACA/test-cases`).set(auth(qcToken)).send({ functionId, title: 'Allowed create' }).expect(201);
    testCaseId = created.body.id;
    await ctx.http().patch(`${api}/test-cases/${testCaseId}`).set(auth(qcToken)).send({ title: 'Denied edit' }).expect(403);
    await ctx.http().delete(`${api}/test-cases/${testCaseId}`).set(auth(qcToken)).expect(403);
    await ctx.http().post(`${api}/projects/RBACB/issues`).set(auth(qcToken)).send({ type: 'task', title: 'Other project developer' }).expect(201);
  });

  it('validates bulk payload permissions rather than relying on a coarse editor permission', async () => {
    await setPermissions(['testcase.edit', 'issue.edit']).expect(200);
    await ctx.http().post(`${api}/projects/RBACA/test-cases/bulk`).set(auth(qcToken)).send({ ids: [String(testCaseId)], set: { deleted: true } }).expect(403);
    const issue = await ctx.http().post(`${api}/projects/RBACA/issues`).set(auth(admin)).send({ type: 'task', title: 'Bulk guarded' }).expect(201);
    await ctx.http().post(`${api}/projects/RBACA/issues/bulk`).set(auth(qcToken)).send({ issueKeys: [issue.body.key], set: { deleted: true } }).expect(403);
    const project = await ctx.prisma.project.findUniqueOrThrow({ where: { key: 'RBACA' } });
    const done = await ctx.prisma.workflowStatus.findFirstOrThrow({ where: { projectId: project.id, category: 'done' } });
    await ctx.http().post(`${api}/projects/RBACA/issues/bulk`).set(auth(qcToken)).send({ issueKeys: [issue.body.key], set: { statusId: Number(done.id) } }).expect(403);
    await setPermissions(['testcase.bug.link']).expect(200);
    await ctx.http().post(`${api}/test-cases/${testCaseId}/bugs`).set(auth(qcToken)).send({ createBug: true }).expect(403);
    await setPermissions(['requirement.delete']).expect(200);
    await ctx.http().delete(`${api}/requirements/${functionId}`).set(auth(qcToken)).expect(403);
    await setPermissions(['testcase.delete']).expect(200);
    await ctx.http().post(`${api}/projects/RBACA/test-cases/bulk`).set(auth(qcToken)).send({ ids: [String(testCaseId)], set: { deleted: true } }).expect(200);
  });

  it('separates deleting own items from deleting items owned by other members', async () => {
    const issue = await ctx.http().post(`${api}/projects/RBACA/issues`).set(auth(admin)).send({ type: 'task', title: 'Owned by admin' }).expect(201);
    await setPermissions(['issue.delete']).expect(200);
    await ctx.http().delete(`${api}/issues/${issue.body.key}`).set(auth(qcToken)).expect(403);
    await setPermissions(['issue.delete.any']).expect(200);
    await ctx.http().delete(`${api}/issues/${issue.body.key}`).set(auth(qcToken)).expect(204);
  });

  it('cannot delegate permissions above the acting member or alter global role definitions', async () => {
    await setPermissions(['project.members.create', 'project.members.edit']).expect(200);
    await ctx.http().patch(`${api}/projects/RBACA/members/${qcId}`).set(auth(qcToken)).send({ role: 'admin' }).expect(403);
    await ctx.http().get(`${api}/roles`).set(auth(qcToken)).expect(403);
    await ctx.http().post(`${api}/roles`).set(auth(qcToken)).send({ key: 'escalate', name: 'Escalate', permissions: [] }).expect(403);
    await ctx.http().patch(`${api}/roles/${roleId}`).set(auth(qcToken)).send({ permissions: ['settings.workflow.edit'] }).expect(403);
    await ctx.http().patch(`${api}/projects/RBACA/members/${qcId}`).set(auth(admin)).send({ role: 'viewer', roleId }).expect(400);
    await ctx.http().patch(`${api}/projects/RBACA/members/${qcId}`).set(auth(admin)).send({ roleId: 999999 }).expect(404);
  });

  it('rejects wildcard/unknown grants, hides protected metadata, and revokes access on the next request', async () => {
    await setPermissions(['*']).expect(400);
    await setPermissions(['testcase.view']).expect(200);
    const shell = await ctx.http().get(`${api}/projects/RBACA`).set(auth(qcToken)).expect(200);
    expect(shell.body.key).toBe('RBACA');
    expect(shell.body.settings).toBeUndefined();
    expect(shell.body.description).toBeUndefined();
    await setPermissions([]).expect(200);
    await ctx.http().get(`${api}/projects/RBACA/test-cases`).set(auth(qcToken)).expect(403);
    await ctx.http().get(`${api}/projects/RBACA`).set(auth(qcToken)).expect(403);
  });

  it('requires access to the parent item before issuing an attachment URL', async () => {
    const project = await ctx.prisma.project.findUniqueOrThrow({ where: { key: 'RBACA' } });
    const attachment = await ctx.prisma.attachment.create({ data: { id: randomUUID(), projectId: project.id, entity: 'issue', entityId: 1n, kind: 'file', objectKey: 'test/permission.txt', fileName: 'permission.txt', mimeType: 'text/plain', sizeBytes: 1n, uploadedBy: BigInt(qcId), status: 'ready' } });
    await setPermissions(['attachment.view']).expect(200);
    await ctx.http().get(`${api}/attachments/${attachment.id}/url`).set(auth(qcToken)).expect(403);
    await setPermissions(['attachment.view', 'issue.view']).expect(200);
    await ctx.http().get(`${api}/attachments/${attachment.id}/url`).set(auth(qcToken)).expect(200);
  });

  it('stops job retrieval after its project is deleted', async () => {
    await setupProject(ctx, 'JOBRBAC', 'Tối giản');
    await setPermissions(['testcase.export']).expect(200);
    await ctx.http().post(`${api}/projects/JOBRBAC/members`).set(auth(admin)).send({ userId: qcId, roleId }).expect(201);
    const queued = await ctx.http().post(`${api}/projects/JOBRBAC/test-cases/export`).set(auth(qcToken)).send({}).expect(202);
    await ctx.http().get(`${api}/jobs/${queued.body.jobId}`).set(auth(qcToken)).expect(200);
    await ctx.http().delete(`${api}/projects/JOBRBAC`).set(auth(admin)).expect(204);
    await ctx.http().get(`${api}/jobs/${queued.body.jobId}`).set(auth(qcToken)).expect(403);
  });

  it('keeps role references in history and prevents deleting an assigned role', async () => {
    await ctx.http().delete(`${api}/roles/${roleId}`).set(auth(admin)).expect(409);
    await ctx.http().post(`${api}/projects/RBACA/members/${qcId}/leave`).set(auth(admin)).send({}).expect(200);
    await ctx.http().delete(`${api}/roles/${roleId}`).set(auth(admin)).expect(409);
    const members = await ctx.http().get(`${api}/projects/RBACA/members?status=all`).set(auth(admin)).expect(200);
    expect(members.body.find((member: any) => member.userId === qcId)).toMatchObject({ roleId, roleName: 'QC', leftAt: expect.any(String) });
  });
});
