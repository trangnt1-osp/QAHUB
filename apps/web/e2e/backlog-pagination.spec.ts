import { expect, test } from '@playwright/test';
import { login } from './helpers';

const issues = Array.from({ length: 115 }, (_, index) => ({
  id: 900000 + index, key: `ELMS-${900000 + index}`, number: 900000 + index,
  projectId: 1, type: 'task', title: `Pagination issue ${index + 1}`, priority: 'medium', source: 'manual',
  status: { id: 1, name: 'To Do', category: 'todo', color: '#777777' }, statusId: 1,
  assignee: null, reporter: null, labels: [], parent: null, sprintId: null, rank: String(index),
  estimateMinutes: null, dueDate: null, version: 1, occurrenceCount: 0,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
}));

test.beforeEach(async ({ page }) => {
  await login(page, 'admin@local.test', 'Admin@12345');
  await page.route('**/api/v1/projects/ELMS/backlog*', async (route) => {
    const filtered = new URL(route.request().url()).searchParams.has('q');
    await route.fulfill({ json: { sprints: [], backlog: {
      issues: filtered ? issues.slice(0, 3) : issues.slice(0, 100), total: filtered ? 3 : 115,
      nextCursor: filtered ? null : 'pagination-next',
    } } });
  });
});

test('backlog numbers continue across pages, supports larger page sizes and resets on filtering', async ({ page }) => {
  await page.goto('/projects/ELMS/backlog');
  const pagination = page.getByTestId('pagination-backlog');
  await expect(page.getByTestId(`issue-row-${issues[0].key}`).getByLabel('STT')).toHaveText('1');
  await expect(page.locator('[data-testid^="issue-row-"]')).toHaveCount(10);
  await pagination.getByTitle('2', { exact: true }).click();
  await expect(page.getByTestId(`issue-row-${issues[10].key}`).getByLabel('STT')).toHaveText('11');
  await expect(page.getByTestId(`issue-row-${issues[0].key}`)).toHaveCount(0);
  await pagination.getByRole('combobox').press('ArrowDown');
  await page.getByTitle('20 / trang', { exact: true }).click();
  await expect(page.getByTestId(`issue-row-${issues[0].key}`).getByLabel('STT')).toHaveText('1');
  await pagination.getByTitle('2', { exact: true }).click();
  await expect(page.getByTestId(`issue-row-${issues[20].key}`).getByLabel('STT')).toHaveText('21');
  await page.getByPlaceholder('Search backlog').fill('filtered');
  await expect(pagination).toContainText('3 items');
  await expect(page.getByTestId(`issue-row-${issues[0].key}`).getByLabel('STT')).toHaveText('1');
});

test('backlog fetches past the initial 100 issues and retries a failed cursor request', async ({ page }) => {
  let cursorRequests = 0;
  await page.route('**/api/v1/projects/ELMS/issues*', async (route) => {
    if (!new URL(route.request().url()).searchParams.has('cursor')) return route.continue();
    cursorRequests += 1;
    if (cursorRequests === 1) return route.fulfill({ status: 500, json: { message: 'Cursor temporarily unavailable' } });
    await route.fulfill({ json: { items: issues.slice(100), nextCursor: null } });
  });
  await page.goto('/projects/ELMS/backlog');
  const pagination = page.getByTestId('pagination-backlog');
  await pagination.getByTitle('12', { exact: true }).click();
  await expect(pagination.getByRole('alert')).toBeVisible();
  await pagination.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByTestId(`issue-row-${issues[110].key}`).getByLabel('STT')).toHaveText('111');
  await expect(page.locator('[data-testid^="issue-row-"]')).toHaveCount(5);
  expect(cursorRequests).toBe(2);
});


test('a delayed cursor response cannot append to a new filter scope', async ({ page }) => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/v1/projects/ELMS/issues*', async (route) => {
    if (!new URL(route.request().url()).searchParams.has('cursor')) return route.continue();
    await gate;
    await route.fulfill({ json: { items: issues.slice(100), nextCursor: null } });
  });
  await page.goto('/projects/ELMS/backlog');
  const cursorRequested = page.waitForRequest((request) => new URL(request.url()).searchParams.has('cursor'));
  await page.getByTestId('pagination-backlog').getByTitle('12', { exact: true }).click();
  await cursorRequested;
  await page.getByPlaceholder('Search backlog').fill('filtered');
  await expect(page.getByTestId('pagination-backlog')).toContainText('3 items');
  const cursorReturned = page.waitForResponse((response) => new URL(response.url()).searchParams.has('cursor'));
  release();
  await cursorReturned;
  await expect(page.locator('[data-testid^="issue-row-"]')).toHaveCount(3);
  await expect(page.getByTestId(`issue-row-${issues[110].key}`)).toHaveCount(0);
});
