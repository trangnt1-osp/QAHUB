import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('custom role controls project menu, tabs, actions, direct links and current-session grants', async ({ page, browser, baseURL }) => {
  test.setTimeout(90_000);
  await login(page, 'admin@local.test', 'Admin@12345');
  await page.getByRole('menuitem', { name: /Vai trò/ }).click();
  await page.getByRole('button', { name: /Thêm vai trò/ }).click();
  const drawer = page.getByRole('dialog', { name: 'Thêm vai trò', exact: true });
  await drawer.getByLabel('Tên vai trò', { exact: true }).fill('QC Browser');
  await drawer.getByLabel('Mã vai trò', { exact: true }).fill('qc-browser');
  for (const permission of ['Xem Dashboard', 'Xem thông tin dự án', 'Xem Backlog', 'Xem Active Sprint / Phase', 'Xem Test cases và Epic / Function']) {
    await drawer.getByRole('textbox', { name: 'Tìm quyền', exact: true }).fill(permission);
    await drawer.getByRole('checkbox', { name: permission, exact: true }).check();
  }
  await drawer.getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect(drawer).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: 'QC Browser' })).toBeVisible();

  const session = await (await page.request.post('/api/v1/auth/login', { data: { email: 'admin@local.test', password: 'Admin@12345' } })).json();
  const headers = { Authorization: `Bearer ${session.accessToken}` };
  const templates = await (await page.request.get('/api/v1/workflow-templates', { headers })).json();
  const roles = await (await page.request.get('/api/v1/roles', { headers })).json();
  const role = roles.find((candidate: { key: string }) => candidate.key === 'qc-browser');
  const created = await page.request.post('/api/v1/projects', { headers, data: { key: 'RBACUI', name: 'Role UI project', workflowTemplateId: templates.find((t: { name: string }) => t.name === 'Tối giản').id } });
  expect(created.ok()).toBeTruthy();
  const user = await (await page.request.post('/api/v1/users', { headers, data: { displayName: 'QC Browser User', email: 'qc-browser@local.test', password: 'Password1!', systemRole: 'member' } })).json();
  expect((await page.request.post('/api/v1/projects/RBACUI/members', { headers, data: { userId: user.id, role: 'viewer' } })).ok()).toBeTruthy();
  await page.goto('/projects/RBACUI/info');
  const members = page.locator('.ant-card').filter({ hasText: 'Thành viên dự án' });
  await members.getByRole('combobox', { name: 'Vai trò của QC Browser User', exact: true }).press('ArrowDown');
  await page.locator('.ant-select-dropdown:visible').getByText('QC Browser', { exact: true }).click();
  await expect.poll(async () => {
    const rows = await (await page.request.get('/api/v1/projects/RBACUI/members', { headers })).json();
    return rows.find((member: { userId: number }) => member.userId === user.id).roleId;
  }).toBe(role.id);

  const context = await browser.newContext({ baseURL, locale: 'vi-VN' });
  try {
    const qc = await context.newPage();
    await login(qc, 'qc-browser@local.test');
    await expect(qc.getByRole('menuitem', { name: /Cấu hình/ })).toHaveCount(0);
    await expect(qc.getByRole('menuitem', { name: /Vai trò/ })).toHaveCount(0);
    await qc.goto('/projects/RBACUI/info');
    await expect(qc.getByRole('tab', { name: /Summary/ })).toHaveCount(0);
    await expect(qc.getByRole('tab', { name: /Backlog/ })).toBeVisible();
    await expect(qc.getByRole('tab', { name: /Active sprint/ })).toBeVisible();
    await expect(qc.getByRole('combobox', { name: 'Chế độ theo dõi', exact: true })).toBeDisabled();
    await expect(qc.getByRole('button', { name: /Tạo sprint/ })).toHaveCount(0);
    await expect(qc.locator('.ant-card').filter({ hasText: 'Thành viên dự án' })).toHaveCount(0);
    await qc.getByRole('tab', { name: /Backlog/ }).click();
    await expect(qc.getByRole('button', { name: /Tạo sprint|Create sprint/ })).toHaveCount(0);
    await qc.getByRole('tab', { name: /Test cases/ }).click();
    await expect(qc.getByRole('button', { name: /plus Test case/ })).toHaveCount(0);
    await expect(qc.getByRole('button', { name: /Import|Export/ })).toHaveCount(0);
    await qc.goto('/settings/projects/RBACUI/workflow');
    await expect(qc.getByText('Không có quyền truy cập', { exact: true })).toBeVisible();
    await qc.goto('/roles');
    await expect(qc.getByText('Không có quyền truy cập', { exact: true })).toBeVisible();

    expect((await page.request.patch(`/api/v1/roles/${role.id}`, { headers, data: { permissions: [...role.permissions, 'testcase.create', 'settings.workflow.view'] } })).ok()).toBeTruthy();
    await qc.goto('/projects/RBACUI/test-cases');
    await expect(qc.getByRole('button', { name: /plus Test case/ })).toBeVisible();
    await expect(qc.getByRole('button', { name: /Import|Export/ })).toHaveCount(0);
    await expect(qc.getByRole('menuitem', { name: /Cấu hình/ })).toBeVisible();
    await qc.goto('/settings/projects/RBACUI/workflow');
    await expect(qc.getByText('Ma trận chuyển trạng thái', { exact: true })).toBeVisible();
    await expect(qc.getByRole('button', { name: 'Lưu workflow', exact: true })).toHaveCount(0);
    await expect(qc.getByRole('button', { name: /Thêm trạng thái/ })).toBeDisabled();
  } finally { await context.close(); }
});
