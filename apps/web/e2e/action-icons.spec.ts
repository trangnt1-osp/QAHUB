import { expect, test } from '@playwright/test';
import { login } from './helpers';

test.beforeEach(async ({ page }) => { await login(page, 'admin@local.test', 'Admin@12345'); });

test('member actions use icons with tooltips and retain view/edit/reset confirmation', async ({ page }) => {
  await page.goto('/members');
  const row = page.getByRole('row').filter({ hasText: 'dev1@local.test' });
  const view = row.getByRole('button', { name: 'Xem', exact: true });
  await expect(view).toHaveText('');
  await view.hover();
  await expect(page.getByRole('tooltip').filter({ hasText: /^Xem$/ })).toBeVisible();
  await view.click();
  const drawer = page.getByRole('dialog', { name: 'Thông tin người dùng' });
  await expect(drawer.getByLabel('Email', { exact: true })).toHaveValue('dev1@local.test');
  await page.keyboard.press('Escape');
  await expect(drawer).not.toBeVisible();
  const edit = row.getByRole('button', { name: 'Sửa', exact: true });
  await edit.hover();
  await expect(page.getByRole('tooltip').filter({ hasText: /^Sửa$/ })).toBeVisible();
  await edit.click();
  await expect(drawer.getByLabel('Email', { exact: true })).toBeEditable();
  await drawer.getByRole('button', { name: 'Hủy', exact: true }).click();
  const reset = row.getByRole('button', { name: 'Đặt lại mật khẩu', exact: true });
  await reset.hover();
  await expect(page.getByRole('tooltip').filter({ hasText: /^Đặt lại mật khẩu$/ })).toBeVisible();
  await reset.click();
  await expect(page.getByText('Đặt lại mật khẩu cho người dùng này?', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Hủy', exact: true }).click();
});

test('project edit icon does not navigate the row and member leave icon keeps confirmation', async ({ page }) => {
  await page.goto('/projects');
  const edit = page.getByRole('row').filter({ hasText: 'ELMS' }).getByRole('button', { name: 'Sửa', exact: true });
  await expect(edit).toHaveText('');
  await edit.hover();
  await expect(page.getByRole('tooltip').filter({ hasText: /^Sửa$/ })).toBeVisible();
  await edit.click();
  await expect(page).toHaveURL(/\/projects$/);
  const modal = page.getByRole('dialog', { name: 'Sửa dự án' });
  await expect(modal.getByLabel('Tên dự án')).not.toHaveValue('');
  await modal.getByRole('button', { name: 'Hủy', exact: true }).click();
  await page.goto('/projects/ELMS/info');
  const leave = page.getByRole('row').filter({ hasText: 'dev1@local.test' }).getByRole('button', { name: 'Rời dự án', exact: true });
  await leave.hover();
  await expect(page.getByRole('tooltip').filter({ hasText: /^Rời dự án$/ })).toBeVisible();
  await leave.click();
  const confirmation = page.getByRole('dialog', { name: 'Ghi nhận rời dự án' });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Hủy', exact: true }).click();
});
