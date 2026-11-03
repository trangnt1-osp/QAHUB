import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('quick search filters the project backlog and clearing returns to the original screen', async ({ page }) => {
  await login(page, 'admin@local.test', 'Admin@12345');
  await page.goto('/members');
  const search = page.getByPlaceholder('Tìm nhanh theo mã item (ELMS-2249)');
  await search.fill(' elms-1 ');
  await search.press('Enter');
  await expect(page).toHaveURL(/\/projects\/ELMS\/backlog\?q=ELMS-1$/);
  await expect(page.getByTestId('screen-title')).toHaveText('ELMS / Backlog');
  await expect(page.getByTestId('backlog-scroll').getByText('ELMS-1', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await expect(search).toHaveValue('ELMS-1');
  await search.fill('ELMS-999999');
  await search.press('Enter');
  await expect(page.getByText('Không có item phù hợp.', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/projects\/ELMS\/backlog\?q=ELMS-999999$/);
  await search.fill('DEMO-1');
  await search.press('Enter');
  await expect(page).toHaveURL(/\/projects\/DEMO\/backlog\?q=DEMO-1$/);
  await expect(page.getByTestId('backlog-scroll').getByText('DEMO-1', { exact: true })).toBeVisible();
  await search.fill('');
  await expect(page).toHaveURL(/\/members$/);
  await search.fill('khong hop le');
  await search.press('Enter');
  await expect(page.getByText('Nhập mã item đúng định dạng, ví dụ ELMS-2249.', { exact: true })).toBeVisible();
  await search.fill('');
  await expect(page).toHaveURL(/\/members$/);
});

test('clear icon restores the previous filters, including after an unknown project search', async ({ page }) => {
  await login(page, 'admin@local.test', 'Admin@12345');
  await page.goto('/projects/ELMS/backlog?type=bug');
  const search = page.getByPlaceholder('Tìm nhanh theo mã item (ELMS-2249)');
  await search.fill('DEMO-1');
  await search.press('Enter');
  await expect(page.getByTestId('issue-row-DEMO-1')).toBeVisible();
  await page.locator('header .ant-input-clear-icon').click();
  await expect(page).toHaveURL(/\/projects\/ELMS\/backlog\?type=bug$/);
  await search.fill('UNKNOWN-999999');
  await search.press('Enter');
  await expect(page.getByText('Không có item phù hợp.', { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.locator('header .ant-input-clear-icon').click();
  await expect(page).toHaveURL(/\/projects\/ELMS\/backlog\?type=bug$/);
});
