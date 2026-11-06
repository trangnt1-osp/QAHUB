import { auth, createTestApp, setupProject, TestCtx } from './helpers';

describe('Public confirmed Bug API', () => {
  let ctx: TestCtx;
  let key: string;
  let otherKey: string;
  let runsKey: string;
  let admin: string;
  const endpoint = '/api/v1/ingest/bugs';
  const bug = (externalId: string, extra = {}) => ({ externalId, confirmed: true, title: 'Không lưu thuế suất', steps: ['Mở vật tư', 'Chọn thuế và lưu'], expected: 'Giữ thuế suất đã chọn', actual: 'Thuế suất bị mất', ...extra });
  const send = (bugs: unknown[], token = key) => ctx.http().post(endpoint).set(auth(token)).send({ bugs });
  const makeKey = async (project: string, scopes: string[]) => (await ctx.http().post(`/api/v1/projects/${project}/api-keys`).set(auth(admin)).send({ name: 'QC integration', scopes }).expect(201)).body.key;

  beforeAll(async () => {
    ctx = await createTestApp();
    const project = await setupProject(ctx, 'PUB', 'Có QA');
    admin = project.tokens.admin;
    await setupProject(ctx, 'ALT', 'Tối giản');
    key = await makeKey('PUB', ['issues:write']);
    otherKey = await makeKey('ALT', ['issues:write']);
    runsKey = await makeKey('PUB', ['runs:write']);
  });
  afterAll(async () => { if (ctx) await ctx.close(); });

  it('requires a valid API key and issues:write scope', async () => {
    await ctx.http().post(endpoint).send({ bugs: [bug('unauthorized')] }).expect(401);
    await send([bug('wrong-scope')], runsKey).expect(403);
    await send([bug('jwt-not-key')], admin).expect(401);
  });

  it('requires confirmation, nonblank fields, unique IDs and bounded batches', async () => {
    await send([bug('unconfirmed', { confirmed: false })]).expect(400);
    await send([bug('blank', { title: '  ' })]).expect(400);
    await send([bug('bad-steps', { steps: [] })]).expect(400);
    await send([bug('duplicate'), bug('duplicate')]).expect(400);
    await send([]).expect(400);
    await send([null]).expect(400);
    await send([bug('invalid-attachment', { attachments: [null] })]).expect(400);
    await send(Array.from({ length: 101 }, (_, i) => bug(`limit-${i}`))).expect(400);
  });

  it('creates confirmed Bugs directly in Backlog with API provenance and readable content', async () => {
    const response = await send([bug('local-1', { priority: 'high', testCaseIds: ['TC-01'], environment: 'staging' }), bug('local-2')]).expect(200);
    expect(response.body).toMatchObject({ created: 2, existing: 0, failed: 0 });
    const item = response.body.items[0];
    expect(item).toMatchObject({ externalId: 'local-1', status: 'created', url: `/browse/${item.issueKey}` });
    const detail = (await ctx.http().get(`/api/v1/issues/${item.issueKey}`).set(auth(admin)).expect(200)).body;
    expect(detail).toMatchObject({ type: 'bug', source: 'auto', priority: 'high', sprintId: null, reporterId: null });
    expect(detail.status.category).not.toBe('triage');
    expect(detail.createdByApiKey.name).toBe('QC integration');
    expect(JSON.stringify(detail.description)).toContain('TC-01');
    expect(await ctx.prisma.issueStatusChange.count({ where: { issueId: BigInt(detail.id) } })).toBe(1);
  });

  it('is idempotent under concurrent retries, without overwriting existing content', async () => {
    const responses = await Promise.all([send([bug('concurrent')]), send([bug('concurrent')])]);
    responses.forEach((r) => expect(r.status).toBe(200));
    expect(responses.map((r) => r.body.items[0].status).sort()).toEqual(['created', 'existing']);
    expect(responses[0].body.items[0].issueKey).toBe(responses[1].body.items[0].issueKey);
    const retry = await send([bug('concurrent', { title: 'Changed' })]).expect(200);
    const issue = await ctx.prisma.issue.findUniqueOrThrow({ where: { id: BigInt(retry.body.items[0].issueId) } });
    expect(issue.title).toBe('Không lưu thuế suất');
    await ctx.prisma.issue.update({ where: { id: issue.id }, data: { deletedAt: new Date() } });
    expect((await send([bug('concurrent')]).expect(200)).body.items[0]).toMatchObject({ status: 'existing', deleted: true });
  });

  it('scopes external IDs by project and reports business errors per item', async () => {
    const a = await send([bug('shared')]).expect(200);
    const b = await send([bug('shared')], otherKey).expect(200);
    expect(a.body.items[0].issueKey).toMatch(/^PUB-/);
    expect(b.body.items[0].issueKey).toMatch(/^ALT-/);
    const result = await send([bug('invalid-assignee', { assigneeId: 999999 }), bug('valid-after-error')]).expect(200);
    expect(result.body).toMatchObject({ created: 1, failed: 1 });
    expect(result.body.items[0].status).toBe('failed');
  });

  it('supports resumable evidence upload and prevents cross-project completion', async () => {
    const attachments = [{ ref: 'shot', kind: 'screenshot', fileName: 'failure.png', mimeType: 'image/png', size: 100 }];
    const response = await send([bug('evidence', { attachments })]).expect(200);
    const item = response.body.items[0];
    const upload = item.uploads[0];
    const complete = `/api/v1/ingest/bug-attachments/${upload.attachmentId}/complete`;
    await ctx.http().post(complete).set(auth(otherKey)).expect(404);
    await ctx.http().post(complete).set(auth(key)).expect(422);
    const retry = await send([bug('evidence', { attachments })]).expect(200);
    expect(retry.body.items[0].uploads[0].attachmentId).toBe(upload.attachmentId);
    ctx.storage.put(upload.uploadUrl.replace('http://fake-s3/put/', ''), 100);
    await ctx.http().post(complete).set(auth(key)).expect(200);
    await ctx.http().post(complete).set(auth(key)).expect(200);
    expect((await send([bug('evidence', { attachments })]).expect(200)).body.items[0].uploads).toEqual([]);
    const detail = await ctx.http().get(`/api/v1/issues/${item.issueKey}`).set(auth(admin)).expect(200);
    expect(detail.body.attachments).toHaveLength(1);
  });

  it('rejects oversized declarations and uploaded files with a different size', async () => {
    const attachment = { ref: 'shot', kind: 'screenshot', fileName: 'shot.png', mimeType: 'image/png', size: 100 };
    await send([bug('too-large', { attachments: [{ ...attachment, size: 201 * 1024 * 1024 }] })]).expect(400);
    const response = await send([bug('bad-size', { attachments: [attachment] })]).expect(200);
    const upload = response.body.items[0].uploads[0];
    ctx.storage.put(upload.uploadUrl.replace('http://fake-s3/put/', ''), 101);
    await ctx.http().post(`/api/v1/ingest/bug-attachments/${upload.attachmentId}/complete`).set(auth(key)).expect(422);
    await ctx.http().post('/api/v1/ingest/bug-attachments/not-a-uuid/complete').set(auth(key)).expect(400);
  });

  it('keeps IDs stable when rotating keys, and rejects expired/revoked keys', async () => {
    const rotated = await makeKey('PUB', ['issues:write']);
    const response = await send([bug('local-1')], rotated).expect(200);
    expect(response.body.items[0]).toMatchObject({ status: 'existing' });
    const { hashKey } = await import('../src/api-keys/api-keys.service');
    await ctx.prisma.apiKey.update({ where: { keyHash: hashKey(rotated) }, data: { expiresAt: new Date(0) } });
    await send([bug('expired')], rotated).expect(401);
    await ctx.prisma.apiKey.update({ where: { keyHash: hashKey(rotated) }, data: { expiresAt: null, revokedAt: new Date() } });
    await send([bug('revoked')], rotated).expect(401);
  });
});
