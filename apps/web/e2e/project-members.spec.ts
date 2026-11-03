import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('project members live in project information instead of Member tabs', async ({ page }) => {
  await login(page, 'admin@local.test', 'Admin@12345');
  await page.goto('/members');
  await expect(page.getByTestId('screen-title')).toHaveText('Người dùng');
  await expect(page.getByRole('tab', { name: 'Thành viên dự án' })).toHaveCount(0);
  await page.goto('/projects/ELMS/summary');
  await page.getByRole('tab', { name: /Thông tin dự án$/ }).click();
  await expect(page).toHaveURL(/\/projects\/ELMS\/info$/);
  for (const name of ['Thành viên', 'Vai trò', 'Ngày tham gia dự án', 'Ngày rời dự án']) {
    await expect(page.getByRole('columnheader', { name, exact: true })).toBeVisible();
  }
  await expect(page.getByRole('row').filter({ hasText: 'lead@local.test' })).toContainText('Đang tham gia');
});

test('add, leave and rejoin retain separate periods; viewers have read-only information', async ({ page, request }) => {
  const loginResponse = await request.post('http://localhost:3100/api/v1/auth/login', { data: { email: 'admin@local.test', password: 'Admin@12345' } });
  const { accessToken } = await loginResponse.json();
  const created = await request.post('http://localhost:3100/api/v1/users', {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: { email: 'period@local.test', displayName: 'Period User', systemRole: 'member', password: 'Password1!' },
  });
  expect(created.ok()).toBeTruthy();
  await login(page, 'admin@local.test', 'Admin@12345');
  await page.goto('/projects/ELMS/info');
  async function add(date: string) {
    await page.getByLabel('Thành viên', { exact: true }).click();
    await page.getByText('Period User (period@local.test)', { exact: true }).click();
    const input = page.getByLabel('Ngày tham gia', { exact: true });
    await input.fill(date);
    await input.press('Enter');
    await page.getByRole('button', { name: /Thêm thành viên$/ }).click();
  }
  await add('01/01/2026');
  const rows = page.getByRole('row').filter({ hasText: 'period@local.test' });
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('01/01/2026');
  await rows.getByRole('button', { name: 'Rời dự án', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Ghi nhận rời dự án' });
  const left = modal.getByLabel('Ngày rời dự án', { exact: true });
  await left.fill('02/01/2026');
  await left.press('Enter');
  await modal.getByRole('button', { name: 'Xác nhận rời dự án', exact: true }).click();
  await expect(modal).not.toBeVisible();
  await expect(rows).toContainText('Đã rời');
  await expect(rows).toContainText('02/01/2026');
  await expect(rows.getByRole('button', { name: 'Rời dự án', exact: true })).toHaveCount(0);
  await add('01/02/2026');
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: 'Đang tham gia' })).toContainText('01/02/2026');
  await page.reload();
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: 'Đã rời' })).toContainText('02/01/2026');

  const activeRow = rows.filter({ hasText: 'Đang tham gia' });
  await activeRow.getByRole('combobox').press('ArrowDown');
  await page.locator('.ant-select-dropdown:visible').getByText('viewer', { exact: true }).click();
  await expect(activeRow.getByText('viewer', { exact: true })).toBeVisible();
  await page.context().clearCookies();
  await login(page, 'period@local.test');
  await page.goto('/projects/ELMS/info');
  await expect(page.getByRole('columnheader', { name: 'Ngày rời dự án', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Thêm thành viên$/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Rời dự án', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: /Member/ })).toHaveCount(0);
});
