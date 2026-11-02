import { expect, test, type Locator } from '@playwright/test';
import { login } from './helpers';

async function fillDate(modal: Locator, label: string, value: string) {
  const input = modal.getByLabel(label, { exact: true });
  await input.fill(value);
  await input.press('Enter');
}

test.beforeEach(async ({ page }) => {
  await login(page, 'admin@local.test', 'Admin@12345');
  await page.goto('/projects');
});

test('edit project saves fields and dates without navigating the row', async ({ page }) => {
  await page.getByRole('row').filter({ hasText: 'DEMO' }).getByRole('button', { name: 'Sửa', exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
  const modal = page.getByRole('dialog', { name: 'Sửa dự án' });
  await modal.getByLabel('Tên dự án').fill('Demo updated');
  await modal.getByLabel('Mô tả').fill('Updated description');
  await fillDate(modal, 'Ngày bắt đầu', '02/11/2026');
  await fillDate(modal, 'Ngày kết thúc', '30/11/2026');
  await modal.getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect(modal).not.toBeVisible();
  const row = page.getByRole('row').filter({ hasText: 'DEMO' });
  await expect(row).toContainText('Demo updated');
  await expect(row).toContainText('02/11/2026');
  await expect(row).toContainText('30/11/2026');
  await page.reload();
  await row.getByRole('button', { name: 'Sửa', exact: true }).click();
  await expect(modal.getByLabel('Tên dự án')).toHaveValue('Demo updated');
  await expect(modal.getByLabel('Mô tả')).toHaveValue('Updated description');
  await expect(modal.getByLabel('Ngày bắt đầu', { exact: true })).toHaveValue('02/11/2026');
  await expect(modal.getByLabel('Ngày kết thúc', { exact: true })).toHaveValue('30/11/2026');
});

test('cancel discards changes and invalid ranges cannot save', async ({ page }) => {
  const row = page.getByRole('row').filter({ hasText: 'ELMS' });
  await row.getByRole('button', { name: 'Sửa', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Sửa dự án' });
  const original = await modal.getByLabel('Tên dự án').inputValue();
  await modal.getByLabel('Tên dự án').fill('Discard');
  await fillDate(modal, 'Ngày bắt đầu', '20/11/2026');
  await fillDate(modal, 'Ngày kết thúc', '01/11/2026');
  await modal.getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect(modal.getByText('Ngày kết thúc không được trước ngày bắt đầu')).toBeVisible();
  await modal.getByRole('button', { name: 'Hủy', exact: true }).click();
  await row.getByRole('button', { name: 'Sửa', exact: true }).click();
  await expect(modal.getByLabel('Tên dự án')).toHaveValue(original);
  await expect(modal.getByLabel('Ngày bắt đầu', { exact: true })).toHaveValue('');
});

test('dates can be cleared and stay empty after reload', async ({ page }) => {
  const row = page.getByRole('row').filter({ hasText: 'DEMO' });
  await row.getByRole('button', { name: 'Sửa', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Sửa dự án' });
  await fillDate(modal, 'Ngày bắt đầu', '01/11/2026');
  await fillDate(modal, 'Ngày kết thúc', '30/11/2026');
  await modal.getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect(modal).not.toBeVisible();
  await row.getByRole('button', { name: 'Sửa', exact: true }).click();
  for (const label of ['Ngày bắt đầu', 'Ngày kết thúc']) {
    const picker = modal.getByLabel(label, { exact: true }).locator('..');
    await picker.hover();
    await picker.locator('.ant-picker-clear').click();
  }
  await modal.getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect(modal).not.toBeVisible();
  await page.reload();
  await row.getByRole('button', { name: 'Sửa', exact: true }).click();
  await expect(modal.getByLabel('Ngày bắt đầu', { exact: true })).toHaveValue('');
  await expect(modal.getByLabel('Ngày kết thúc', { exact: true })).toHaveValue('');
});

test('new project dates are editable from general settings', async ({ page }) => {
  await page.getByRole('button', { name: /Tạo dự án$/ }).click();
  const modal = page.getByRole('dialog', { name: 'Tạo dự án' });
  await modal.getByRole('textbox', { name: /Key/ }).fill('DATED');
  await modal.getByLabel('Tên dự án').fill('Dated project');
  await fillDate(modal, 'Ngày bắt đầu', '01/11/2026');
  await fillDate(modal, 'Ngày kết thúc', '30/11/2026');
  await modal.getByLabel('Workflow template').click();
  await page.getByText('Tối giản', { exact: true }).click();
  await modal.getByRole('button', { name: 'Tạo', exact: true }).click();
  await expect(modal).not.toBeVisible();
  await expect(page.getByRole('row').filter({ has: page.getByRole('link', { name: 'DATED', exact: true }) })).toContainText('01/11/2026');
  await page.goto('/settings/projects/DATED/general');
  await expect(page.getByLabel('Ngày bắt đầu', { exact: true })).toHaveValue('01/11/2026');
  await fillDate(page.locator('form').first(), 'Ngày kết thúc', '15/12/2026');
  await page.getByRole('button', { name: 'Lưu', exact: true }).first().click();
  await expect(page.getByText('Đã lưu', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Ngày kết thúc', { exact: true })).toHaveValue('15/12/2026');
});

test('project admin can edit and viewer cannot see edit actions', async ({ page }) => {
  await page.context().clearCookies();
  await login(page, 'lead@local.test');
  await page.goto('/projects');
  await page.getByRole('row').filter({ hasText: 'ELMS' }).getByRole('button', { name: 'Sửa', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Sửa dự án' })).toBeVisible();
  await page.context().clearCookies();
  await login(page, 'viewer@local.test');
  await page.goto('/projects');
  await expect(page.getByRole('link', { name: 'ELMS', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sửa', exact: true })).toHaveCount(0);
});
