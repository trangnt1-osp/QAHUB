import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('test case summary omits the redundant title and uses Vietnamese numeric separators', async ({ page }) => {
  await login(page, 'admin@local.test', 'Admin@12345');
  await page.route('**/api/v1/projects/ELMS/test-cases/summary*', (route) => route.fulfill({ json: { totals: { total: 12345, notStarted: 1234, passed: 11111, failed: 0, blocked: 0, na: 0 }, progress: 82.5 } }));
  await page.goto('/projects/ELMS/test-cases');
  const summary = page.getByTestId('checklist-summary');
  await expect(summary).toContainText('12.345');
  await expect(summary).toContainText('1.234');
  await expect(summary).toContainText('11.111');
  await expect(summary).toContainText('82,5%');
  await expect(page.getByText('Toàn bộ test case của dự án', { exact: true })).toHaveCount(0);
  await expect(page.locator('[col-id="code"]').nth(1)).toContainText('CL_');
});

test('localized numeric input persists the raw numeric value', async ({ page }) => {
  await login(page, 'admin@local.test', 'Admin@12345');
  const session = await (await page.request.post('/api/v1/auth/login', { data: { email: 'admin@local.test', password: 'Admin@12345' } })).json();
  const headers = { Authorization: `Bearer ${session.accessToken}` };
  const created = await page.request.post('/api/v1/projects/ELMS/issues', { headers, data: { type: 'task', title: 'Localized estimate', estimateMinutes: 1234 } });
  expect(created.ok()).toBeTruthy();
  const issue = await created.json();
  await page.goto(`/browse/${issue.key}`);
  const estimate = page.getByRole('spinbutton');
  await expect(estimate).toHaveValue('1.234');
  const saved = page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().endsWith(`/issues/${issue.key}`));
  await estimate.fill('2.345');
  await estimate.press('Tab');
  const response = await saved;
  expect(response.ok()).toBeTruthy();
  expect(response.request().postDataJSON().estimateMinutes).toBe(2345);
  await page.reload();
  await expect(estimate).toHaveValue('2.345');
});
