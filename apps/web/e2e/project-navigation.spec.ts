import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('project tabs offer a direct return and preserve the project list page', async ({ page }) => {
  await login(page, 'admin@local.test', 'Admin@12345');
  const projects = Array.from({ length: 23 }, (_, i) => ({ id: i + 1, key: i === 10 ? 'ELMS' : `P${i + 1}`, name: `Project ${i + 1}`, myRole: 'admin', openIssues: 0, pendingReview: 0, createdAt: '2026-01-01' }));
  await page.route(/\/api\/v1\/projects(?:\?|$)/, (route) => route.fulfill({ json: projects }));
  await page.goto('/projects');
  const table = page.getByTestId('list-table');
  await table.getByTitle('2', { exact: true }).click();
  await table.getByRole('link', { name: 'ELMS', exact: true }).click();
  await expect(page.getByTestId('screen-title')).toHaveText('ELMS / Summary');
  await page.getByRole('tab', { name: /Backlog/ }).click();
  await expect(page.getByTestId('screen-title')).toHaveText('ELMS / Backlog');
  await page.getByRole('button', { name: 'Danh sách dự án', exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(table.getByRole('row').nth(1).getByRole('cell').first()).toHaveText('11');
  await page.getByRole('menuitem', { name: /Member/ }).click();
  await page.getByRole('menuitem', { name: /Dự án/ }).click();
  await expect(table.getByRole('link', { name: 'ELMS', exact: true })).toBeVisible();
  await table.getByRole('link', { name: 'ELMS', exact: true }).click();
  await page.goBack();
  await expect(table.getByRole('row').nth(1).getByRole('cell').first()).toHaveText('11');
});
