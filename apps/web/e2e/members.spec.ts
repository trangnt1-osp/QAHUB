import { expect, test } from '@playwright/test';
import { login } from './helpers';

test.beforeEach(async ({ page }) => {
  await login(page, 'admin@local.test', 'Admin@12345');
  await page.goto('/members');
});

test('view and edit use the same drawer, fields and project history', async ({ page }) => {
  const row = page.getByRole('row').filter({ hasText: 'viewer@local.test' });
  await row.getByRole('button', { name: 'Xem', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Thông tin người dùng' });
  await expect(drawer.getByLabel('Email', { exact: true })).toHaveValue('viewer@local.test');
  await expect(drawer.getByLabel('Tên hiển thị')).toHaveAttribute('readonly', '');
  await expect(drawer.getByLabel('Vai trò hệ thống', { exact: true })).toBeDisabled();
  await expect(drawer.getByRole('switch')).toBeDisabled();
  await expect(drawer.getByRole('heading', { name: 'Lịch sử dự án tham gia' })).toBeVisible();
  const historyCount = await drawer.getByRole('row').count();
  const original = await drawer.getByLabel('Tên hiển thị').inputValue();
  await drawer.getByRole('button', { name: 'Sửa', exact: true }).click();
  await expect(drawer.getByLabel('Tên hiển thị')).toBeEditable();
  await expect(drawer.getByLabel('Vai trò hệ thống', { exact: true })).toBeEnabled();
  await expect(drawer.getByRole('heading', { name: 'Lịch sử dự án tham gia' })).toBeVisible();
  await expect(drawer.getByRole('row')).toHaveCount(historyCount);
  await drawer.getByLabel('Tên hiển thị').fill('Discard shared drawer changes');
  await drawer.getByRole('button', { name: 'Hủy', exact: true }).click();
  await expect(drawer).not.toBeVisible();
  await row.getByRole('button', { name: 'Sửa', exact: true }).click();
  await expect(drawer.getByLabel('Tên hiển thị')).toHaveValue(original);
  await expect(drawer.getByRole('heading', { name: 'Lịch sử dự án tham gia' })).toBeVisible();
});

test('admin edits a user and changes persist after reload', async ({ page }) => {
  const row = page.getByRole('row').filter({ hasText: 'viewer@local.test' });
  await row.getByRole('button', { name: 'Sửa', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Thông tin người dùng' });
  await expect(modal.getByLabel('Email', { exact: true })).toHaveValue('viewer@local.test');
  await modal.getByLabel('Tên hiển thị').fill('Viewer updated');
  await modal.getByLabel('Email', { exact: true }).fill('viewer.updated@local.test');
  await modal.getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect(modal).not.toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'viewer.updated@local.test' })).toContainText('Viewer updated');
  await page.reload();
  const updated = page.getByRole('row').filter({ hasText: 'viewer.updated@local.test' });
  await expect(updated).toContainText('Viewer updated');
  await updated.getByRole('button', { name: 'Sửa', exact: true }).click();
  await modal.getByLabel('Tên hiển thị').fill('Vy (Viewer)');
  await modal.getByLabel('Email', { exact: true }).fill('viewer@local.test');
  await modal.getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect(modal).not.toBeVisible();
});

test('duplicate email keeps the modal open and cancel discards changes', async ({ page }) => {
  await page.getByRole('row').filter({ hasText: 'dev1@local.test' }).getByRole('button', { name: 'Sửa', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Thông tin người dùng' });
  const original = await modal.getByLabel('Tên hiển thị').inputValue();
  await modal.getByLabel('Tên hiển thị').fill('Must not save');
  await modal.getByLabel('Email', { exact: true }).fill('admin@local.test');
  await modal.getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect(modal.getByText('Email đã được sử dụng', { exact: true })).toBeVisible();
  await expect(modal.getByLabel('Tên hiển thị')).toHaveValue('Must not save');
  await modal.getByRole('button', { name: 'Hủy', exact: true }).click();
  await page.getByRole('row').filter({ hasText: 'dev1@local.test' }).getByRole('button', { name: 'Sửa', exact: true }).click();
  await expect(modal.getByLabel('Tên hiển thị')).toHaveValue(original);
  await expect(modal.getByLabel('Email', { exact: true })).toHaveValue('dev1@local.test');
});

test('edit form validates email and blank display name', async ({ page }) => {
  await page.getByRole('row').filter({ hasText: 'dev1@local.test' }).getByRole('button', { name: 'Sửa', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Thông tin người dùng' });
  await modal.getByLabel('Tên hiển thị').fill('   ');
  await modal.getByLabel('Email', { exact: true }).fill('invalid');
  await modal.getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect(modal.getByText('Vui lòng nhập tên hiển thị')).toBeVisible();
  await expect(modal.getByText('Email không hợp lệ')).toBeVisible();
});

test('admin cannot change own role or status in the edit form', async ({ page }) => {
  await page.getByRole('row').filter({ hasText: 'admin@local.test' }).getByRole('button', { name: 'Sửa', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Thông tin người dùng' });
  await expect(modal.getByLabel('Vai trò hệ thống', { exact: true })).toBeDisabled();
  await expect(modal.getByRole('switch')).toBeDisabled();
  await expect(modal.getByLabel('Tên hiển thị')).toBeEnabled();
  await expect(modal.getByLabel('Email', { exact: true })).toBeEnabled();
});
