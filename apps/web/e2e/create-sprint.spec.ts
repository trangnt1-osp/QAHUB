import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('create sprint is visible above the backlog without scrolling', async ({ page }) => {
  await login(page, 'admin@local.test', 'Admin@12345');
  await page.goto('/projects/DEMO/backlog');
  const create = page.getByRole('button', { name: 'plus Tạo sprint', exact: true });
  await expect(create).toBeInViewport();
  const created = page.waitForResponse((response) => response.url().endsWith('/projects/DEMO/sprints') && response.request().method() === 'POST');
  await create.click();
  expect((await created).ok()).toBeTruthy();
  await expect(page.getByText('Đã tạo sprint', { exact: true })).toBeVisible();
  await expect(create).toBeEnabled();
});
