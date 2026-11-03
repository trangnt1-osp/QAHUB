import { BUILTIN_ROLE_PERMISSIONS, ProjectRole } from '@ospm/shared';
import { auth, createTestApp, createUser, login, setupProject, TestCtx } from './helpers';

describe('Editable builtin project roles', () => {
  let ctx: TestCtx;
  let admin: string;
  let tokens: Record<string, string>;
  const api = '/api/v1';
  beforeAll(async () => {
    ctx = await createTestApp();
    const setup = await setupProject(ctx, 'BUILTIN', 'Tối giản', { developer: 'builtin-dev@x.test', tester: 'builtin-test@x.test', viewer: 'builtin-view@x.test' });
    admin = setup.tokens.admin;
    tokens = setup.tokens;
    const projectAdmin = await createUser(ctx, 'builtin-admin@x.test', 'Project Admin');
    await ctx.http().post(`${api}/projects/BUILTIN/members`).set(auth(admin)).send({ userId: Number(projectAdmin.id), role: 'admin' }).expect(201);
    tokens.admin = await login(ctx, projectAdmin.email, 'Password1!');
  });
  afterAll(async () => { await ctx?.close(); });

  it.each<ProjectRole>(['admin', 'developer', 'tester', 'viewer'])('edits %s for existing assignments and tokens, including an empty override', async (role) => {
    try {
      const updated = await ctx.http().patch(`${api}/roles/builtin/${role}`).set(auth(admin)).send({ permissions: ['project.info.view'] }).expect(200);
      expect(updated.body).toMatchObject({ key: role, id: null, builtin: true, permissions: expect.arrayContaining(['project.view', 'project.info.view']) });
      const roles = await ctx.http().get(`${api}/roles`).set(auth(admin)).expect(200);
      expect(roles.body.filter((row: any) => row.key === role)).toHaveLength(1);
      expect(roles.body.find((row: any) => row.key === role).permissions).not.toContain('issue.view');
      const me = await ctx.http().get(`${api}/auth/me`).set(auth(tokens[role])).expect(200);
      expect(me.body.projects.find((p: any) => p.projectKey === 'BUILTIN')).toMatchObject({ role, roleId: null, permissions: updated.body.permissions });
      await ctx.http().get(`${api}/projects/BUILTIN`).set(auth(tokens[role])).expect(200);
      await ctx.http().get(`${api}/projects/BUILTIN/issues`).set(auth(tokens[role])).expect(403);
      await ctx.http().patch(`${api}/roles/builtin/${role}`).set(auth(admin)).send({ permissions: [] }).expect(200);
      await ctx.http().get(`${api}/projects/BUILTIN`).set(auth(tokens[role])).expect(403);
      const list = await ctx.http().get(`${api}/projects`).set(auth(tokens[role])).expect(200);
      expect(list.body).toEqual([]);
      const dashboard = await ctx.http().get(`${api}/dashboard`).set(auth(tokens[role])).expect(200);
      expect(dashboard.body.myWork).toEqual([]);
      expect(dashboard.body.recentActivity).toEqual([]);
      expect(dashboard.body.cards.createdLast7d).toBe(0);
      // Global admin access is independent of the editable project Admin definition.
      await ctx.http().get(`${api}/projects/BUILTIN/issues`).set(auth(admin)).expect(200);
      await ctx.http().get(`${api}/roles`).set(auth(admin)).expect(200);
    } finally {
      await ctx.http().patch(`${api}/roles/builtin/${role}`).set(auth(admin)).send({ permissions: BUILTIN_ROLE_PERMISSIONS[role] }).expect(200);
    }
  });

  it('protects builtin identity, validates grants and prevents ordinary members from editing definitions', async () => {
    await ctx.http().patch(`${api}/roles/builtin/viewer`).set(auth(tokens.viewer)).send({ permissions: [] }).expect(403);
    await ctx.http().patch(`${api}/roles/builtin/unknown`).set(auth(admin)).send({ permissions: [] }).expect(404);
    await ctx.http().patch(`${api}/roles/builtin/viewer`).set(auth(admin)).send({ permissions: ['*'] }).expect(400);
    await ctx.http().patch(`${api}/roles/builtin/viewer`).set(auth(admin)).send({}).expect(400);
    await ctx.http().patch(`${api}/roles/builtin/viewer`).set(auth(admin)).send({ permissions: null }).expect(400);
    await ctx.http().patch(`${api}/roles/builtin/viewer`).set(auth(admin)).send({ name: 'Renamed', permissions: [] }).expect(400);
    const override = await ctx.prisma.roleDefinition.findUniqueOrThrow({ where: { key: 'viewer' } });
    await ctx.http().delete(`${api}/roles/${override.id}`).set(auth(admin)).expect(409);
    await ctx.http().patch(`${api}/roles/${override.id}`).set(auth(admin)).send({ permissions: [] }).expect(409);
    const user = await createUser(ctx, 'override-namespace@x.test', 'Namespace');
    await ctx.http().post(`${api}/projects/BUILTIN/members`).set(auth(admin)).send({ userId: Number(user.id), roleId: Number(override.id) }).expect(400);
  });

  it('uses configured builtin permissions when checking delegation', async () => {
    try {
      await ctx.http().patch(`${api}/roles/builtin/developer`).set(auth(admin)).send({ permissions: ['project.members.edit'] }).expect(200);
      await ctx.http().patch(`${api}/roles/builtin/viewer`).set(auth(admin)).send({ permissions: ['settings.workflow.edit'] }).expect(200);
      const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'builtin-test@x.test' } });
      await ctx.http().patch(`${api}/projects/BUILTIN/members/${user.id}`).set(auth(tokens.developer)).send({ role: 'viewer' }).expect(403);
      await ctx.http().patch(`${api}/roles/builtin/viewer`).set(auth(admin)).send({ permissions: ['project.view'] }).expect(200);
      await ctx.http().patch(`${api}/projects/BUILTIN/members/${user.id}`).set(auth(tokens.developer)).send({ role: 'viewer' }).expect(200);
    } finally {
      for (const role of ['developer', 'viewer'] as const) await ctx.http().patch(`${api}/roles/builtin/${role}`).set(auth(admin)).send({ permissions: BUILTIN_ROLE_PERMISSIONS[role] }).expect(200);
    }
  });

  it('does not retain Admin ownership or workflow bypasses after their grants are removed', async () => {
    try {
      await ctx.http().patch(`${api}/roles/builtin/admin`).set(auth(admin)).send({ permissions: ['issue.delete', 'issue.transition'] }).expect(200);
      const created = await ctx.http().post(`${api}/projects/BUILTIN/issues`).set(auth(admin)).send({ type: 'task', title: 'Admin-owned task' }).expect(201);
      await ctx.http().delete(`${api}/issues/${created.body.key}`).set(auth(tokens.admin)).expect(403);
      await ctx.http().post(`${api}/projects/BUILTIN/issues/bulk`).set(auth(tokens.admin)).send({ issueKeys: [created.body.key], set: { deleted: true } }).expect(403);
      const project = await ctx.prisma.project.findUniqueOrThrow({ where: { key: 'BUILTIN' } });
      const done = await ctx.prisma.workflowStatus.findFirstOrThrow({ where: { projectId: project.id, category: 'done' } });
      await ctx.prisma.workflowTransition.deleteMany({ where: { projectId: project.id, toStatusId: done.id } });
      await ctx.http().post(`${api}/issues/${created.body.key}/transitions`).set(auth(tokens.admin)).send({ toStatusId: Number(done.id) }).expect(422);
      await ctx.http().post(`${api}/projects/BUILTIN/issues/bulk`).set(auth(tokens.admin)).send({ issueKeys: [created.body.key], set: { statusId: Number(done.id) } }).expect(422);
      await ctx.http().patch(`${api}/roles/builtin/admin`).set(auth(admin)).send({ permissions: ['issue.delete.any', 'issue.transition', 'workflow.bypass'] }).expect(200);
      await ctx.http().post(`${api}/issues/${created.body.key}/transitions`).set(auth(tokens.admin)).send({ toStatusId: Number(done.id) }).expect(200);
      await ctx.http().delete(`${api}/issues/${created.body.key}`).set(auth(tokens.admin)).expect(204);
    } finally {
      await ctx.http().patch(`${api}/roles/builtin/admin`).set(auth(admin)).send({ permissions: BUILTIN_ROLE_PERMISSIONS.admin }).expect(200);
    }
  });
});
