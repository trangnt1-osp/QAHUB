import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('user profile project role dropdown shares role definitions, saves on Save and synchronizes with project members', async ({ page }) => {
  await login(page, 'admin@local.test', 'Admin@12345');
  const session = await (await page.request.post('/api/v1/auth/login', { data: { email: 'admin@local.test', password: 'Admin@12345' } })).json();
  const headers = { Authorization: `Bearer ${session.accessToken}` };
  const roleResponse = await page.request.post('/api/v1/roles', { headers, data: { key: 'qc-sync', name: 'QC Sync', permissions: ['project.info.view'] } });
  expect(roleResponse.ok()).toBeTruthy();
  const role = await roleResponse.json();
  const userResponse = await page.request.post('/api/v1/users', { headers, data: { displayName: 'A Role Sync', email: 'role-sync@local.test', systemRole: 'member', password: 'Password1!' } });
  expect(userResponse.ok()).toBeTruthy();
  const user = await userResponse.json();
  expect((await page.request.post('/api/v1/projects/ELMS/members', { headers, data: { userId: user.id, role: 'viewer' } })).ok()).toBeTruthy();
  const participation = async () => (await (await page.request.get(`/api/v1/users/${user.id}`, { headers })).json()).projects.find((entry: { leftAt: string | null; project: { key: string } }) => !entry.leftAt && entry.project.key === 'ELMS');
  await page.goto('/members');
  const member = page.getByRole('row').filter({ hasText: 'role-sync@local.test' });
  const drawer = page.getByRole('dialog', { name: 'Thông tin người dùng' });
  async function chooseQC() {
    await drawer.getByRole('combobox', { name: 'Vai trò tại ELMS', exact: true }).press('ArrowDown');
    await page.locator('.ant-select-dropdown:visible').getByText('QC Sync', { exact: true }).click();
  }
  await member.getByRole('button', { name: 'Sửa', exact: true }).click();
  await chooseQC();
  await drawer.getByRole('button', { name: 'Hủy', exact: true }).click();
  expect((await participation()).roleId).toBeNull();
  await member.getByRole('button', { name: 'Sửa', exact: true }).click();
  await chooseQC();
  await drawer.getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect(drawer).not.toBeVisible();
  expect((await participation()).roleId).toBe(role.id);
  const detail = await (await page.request.get(`/api/v1/users/${user.id}`, { headers })).json();
  expect(detail.user.systemRole).toBe('member');
  await page.goto('/projects/ELMS/info');
  const projectRow = page.getByRole('row').filter({ hasText: 'role-sync@local.test' });
  await expect(projectRow).toContainText('QC Sync');
  await projectRow.getByRole('combobox', { name: 'Vai trò của A Role Sync', exact: true }).press('ArrowDown');
  await page.locator('.ant-select-dropdown:visible').getByText('Viewer', { exact: true }).click();
  await expect.poll(async () => (await participation()).roleId).toBeNull();
  await page.goto('/members');
  await member.getByRole('button', { name: 'Xem', exact: true }).click();
  await expect(drawer.getByRole('row').filter({ hasText: 'ELMS' })).toContainText('viewer');
});
