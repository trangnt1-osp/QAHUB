import { expect, test } from '@playwright/test';
import { login } from './helpers';

test.use({ actionTimeout: 15_000 });

test('system admin edits builtin permissions using the existing drawer, with save and cancel', async ({ page, browser, baseURL }) => {
  test.setTimeout(120_000);
  await login(page, 'admin@local.test', 'Admin@12345');
  const session = await (await page.request.post('/api/v1/auth/login', { data: { email: 'admin@local.test', password: 'Admin@12345' } })).json();
  const headers = { Authorization: `Bearer ${session.accessToken}` };
  const initial = await (await page.request.get('/api/v1/roles', { headers })).json();
  const builtins = initial.filter((role: { builtin: boolean }) => role.builtin);
  const userResponse = await page.request.post('/api/v1/users', { headers, data: { email: 'builtin-browser@local.test', displayName: 'Builtin Browser', password: 'Password1!', systemRole: 'member' } });
  expect(userResponse.ok()).toBeTruthy();
  const user = await userResponse.json();
  expect((await page.request.post('/api/v1/projects/ELMS/members', { headers, data: { userId: user.id, role: 'viewer' } })).ok()).toBeTruthy();
  const context = await browser.newContext({ baseURL, locale: 'vi-VN' });
  try {
    const member = await context.newPage();
    await login(member, 'builtin-browser@local.test');
    await member.goto('/projects/ELMS/backlog');
    await expect(member.getByRole('tab', { name: /Thông tin dự án/ })).toBeVisible();
    await page.goto('/roles');
    for (const role of builtins) {
      const row = page.getByRole('row').filter({ has: page.getByRole('cell', { name: role.name, exact: true }) });
      await row.getByRole('button', { name: 'Sửa vai trò', exact: true }).click();
      const drawer = page.getByRole('dialog');
      await drawer.getByRole('button', { name: /Dự án/ }).click();
      await expect(drawer.getByLabel('Tên vai trò', { exact: true })).toBeDisabled();
      await expect(drawer.getByLabel('Mã vai trò', { exact: true })).toBeDisabled();
      const info = drawer.getByRole('checkbox', { name: 'Xem thông tin dự án', exact: true });
      await info.uncheck();
      await drawer.getByRole('button', { name: 'Hủy', exact: true }).click();
      await expect(drawer).toHaveCount(0);
      await expect(page.locator('.ant-drawer-content-wrapper')).toBeHidden();
      await row.getByRole('button', { name: 'Sửa vai trò', exact: true }).click();
      await drawer.getByRole('button', { name: /Dự án/ }).click();
      await expect(info).toBeChecked();
      await info.uncheck();
      const save = page.locator('.ant-drawer-footer').getByRole('button', { name: /Lưu$/ });
      await expect(save).not.toHaveClass(/ant-btn-loading/);
      await save.click();
      await expect(drawer).toHaveCount(0);
      await expect(page.locator('.ant-drawer-content-wrapper')).toBeHidden();
      const saved = await (await page.request.get('/api/v1/roles', { headers })).json();
      expect(saved.filter((entry: { key: string }) => entry.key === role.key)).toHaveLength(1);
      expect(saved.find((entry: { key: string }) => entry.key === role.key).permissions).not.toContain('project.info.view');
      await row.getByRole('button', { name: 'Sửa vai trò', exact: true }).click();
      await drawer.getByRole('button', { name: /Dự án/ }).click();
      await expect(info).not.toBeChecked();
      await drawer.getByRole('button', { name: 'Hủy', exact: true }).click();
      await expect(page.locator('.ant-drawer-content-wrapper')).toBeHidden();
      if (role.key === 'viewer') {
        await member.reload();
        await expect(member.getByRole('tab', { name: /Thông tin dự án/ })).toHaveCount(0);
        await expect(member.getByRole('tab', { name: /Backlog/ })).toBeVisible();
        await member.goto('/projects/ELMS/info');
        await expect(member.getByText('Không có quyền truy cập', { exact: true })).toBeVisible();
      }
    }
  } finally {
    test.setTimeout(test.info().timeout + 20_000);
    for (const role of builtins) expect((await page.request.patch(`/api/v1/roles/builtin/${role.key}`, { headers, data: { permissions: role.permissions } })).ok()).toBeTruthy();
    await context.close();
  }
});
