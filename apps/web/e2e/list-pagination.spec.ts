import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

const users = Array.from({ length: 23 }, (_, i) => ({ id: 1000 + i, displayName: `Pagination User ${i + 1}`, email: `page${i + 1}@local.test`, systemRole: 'member', isActive: true, lastLoginAt: null }));
const projects = Array.from({ length: 23 }, (_, i) => ({ id: i + 1, key: `P${i + 1}`, name: `Project ${i + 1}`, description: '', lead: null, myRole: 'admin', openIssues: 0, pendingReview: 0, activeSprint: null, startDate: null, endDate: null, createdAt: '2026-01-01' }));

test.beforeEach(async ({ page }) => { await login(page, 'admin@local.test', 'Admin@12345'); });

async function changeCursorSize(page: Page, size: number) {
  await page.getByRole('combobox', { name: 'Số dòng mỗi trang', exact: true }).press('ArrowDown');
  await page.locator('.ant-select-dropdown:visible').getByText(`${size} / trang`, { exact: true }).click();
}

test('users and projects show page2 STT and reset when page size changes', async ({ page }) => {
  await page.route(/\/api\/v1\/users(?:\?|$)/, (route) => route.fulfill({ json: users }));
  await page.route(/\/api\/v1\/projects(?:\?|$)/, (route) => route.fulfill({ json: projects }));
  await page.goto('/members');
  const table = page.getByTestId('list-table');
  await expect(table.getByRole('columnheader', { name: 'STT', exact: true })).toBeVisible();
  await table.getByTitle('2', { exact: true }).click();
  await expect(table.getByRole('row').nth(1).getByRole('cell').first()).toHaveText('11');
  await expect(table.getByText('page11@local.test', { exact: true })).toBeVisible();
  await table.getByRole('combobox').last().press('ArrowDown');
  await page.locator('.ant-select-dropdown:visible').getByText('20 / trang', { exact: true }).click();
  await expect(table.getByRole('row').nth(1).getByRole('cell').first()).toHaveText('1');
  await expect(table.getByText('page20@local.test', { exact: true })).toBeVisible();
  await page.goto('/projects');
  await table.getByTitle('2', { exact: true }).click();
  await expect(table.getByRole('row').nth(1).getByRole('cell').first()).toHaveText('11');
  await expect(table.getByRole('link', { name: 'P11', exact: true })).toBeVisible();
});

test('category pagination keeps editable names attached to the correct category', async ({ page }) => {
  const categories = Array.from({ length: 23 }, (_, i) => ({ id: i + 100, name: `Category ${i + 1}`, position: i }));
  await page.route('**/api/v1/projects/ELMS/test-categories', (route) => route.fulfill({ json: categories }));
  let savedId = '';
  await page.route('**/api/v1/projects/ELMS/test-categories/*', async (route) => {
    savedId = new URL(route.request().url()).pathname.split('/').pop()!;
    await route.fulfill({ json: { id: Number(savedId), name: route.request().postDataJSON().name } });
  });
  await page.goto('/settings/projects/ELMS/general');
  const card = page.locator('.ant-card').filter({ has: page.getByText('Category test case', { exact: true }) });
  await card.getByTitle('2', { exact: true }).click();
  const row = card.locator('.ant-list-item').first();
  await expect(row.getByRole('searchbox')).toHaveValue('Category 11');
  await expect(row.getByLabel('STT', { exact: true })).toHaveText('11.');
  await row.getByRole('searchbox').fill('Renamed category 11');
  await row.getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect.poll(() => savedId).toBe('110');
});

test('user project history and project member lists are numbered across pages', async ({ page }) => {
  await page.route(/\/api\/v1\/users(?:\?|$)/, (route) => route.fulfill({ json: users }));
  await page.route('**/api/v1/users/1000', (route) => route.fulfill({ json: { user: users[0], projects: projects.map((project, i) => ({ id: i + 1, project: { ...project, deletedAt: null }, role: 'viewer', joinedAt: '2026-01-01', leftAt: null })) } }));
  await page.goto('/members');
  await page.getByRole('row').filter({ hasText: 'page1@local.test' }).getByRole('button', { name: 'Xem', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Thông tin người dùng' });
  await drawer.getByTitle('2', { exact: true }).click();
  await expect(drawer.getByRole('row').nth(1).getByRole('cell').first()).toHaveText('11');
  await page.keyboard.press('Escape');
  await page.route('**/api/v1/projects/ELMS/members*', (route) => route.fulfill({ json: users.map((user, i) => ({ id: i + 1, userId: user.id, role: 'viewer', user, joinedAt: '2026-01-01', leftAt: null })) }));
  await page.goto('/projects/ELMS/info');
  const table = page.getByTestId('list-table');
  await table.getByTitle('2', { exact: true }).click();
  await expect(table.getByRole('row').nth(1).getByRole('cell').first()).toHaveText('11');
});

test('report cursors reach beyond the old100 limit and reset on filtering', async ({ page }) => {
  const runs = Array.from({ length: 115 }, (_, i) => ({ id: 1000 - i, name: `Run ${i + 1}`, status: 'completed', total: 1, passed: 1, failed: 0, flaky: 0, skipped: 0, bugsCreated: 0, bugsUpdated: 0, passRate: 100, createdAt: '2026-01-01' }));
  await page.route('**/api/v1/projects/ELMS/automation-runs*', (route) => {
    const p = new URL(route.request().url()).searchParams;
    const start = Number(p.get('cursor') ?? 0), size = Number(p.get('limit') ?? 10);
    return route.fulfill({ json: { items: runs.slice(start, start + size), nextCursor: start + size < runs.length ? String(start + size) : null } });
  });
  await page.goto('/reports?project=ELMS');
  await changeCursorSize(page, 100);
  await page.getByRole('button', { name: 'Trang sau', exact: true }).click();
  const table = page.getByTestId('list-table');
  await expect(table.getByRole('row').nth(1).getByRole('cell').first()).toHaveText('101');
  await expect(table.getByText('Run 115', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Trang sau', exact: true })).toBeDisabled();
  await page.getByPlaceholder('Branch', { exact: true }).fill('main');
  await expect(table.getByRole('row').nth(1).getByRole('cell').first()).toHaveText('1');
});

test('run result cursors reach beyond200 and STT continues on the final page', async ({ page }) => {
  await page.route('**/api/v1/automation-runs/9999', (route) => route.fulfill({ json: { id: 9999, projectKey: 'ELMS', status: 'completed', total: 205, passed: 205, failed: 0, flaky: 0, skipped: 0, bugsCreated: 0, bugsUpdated: 0 } }));
  await page.route('**/api/v1/automation-runs/9999/results*', (route) => {
    const p = new URL(route.request().url()).searchParams;
    const start = Number(p.get('cursor') ?? 0), size = Number(p.get('limit') ?? 10);
    const items = Array.from({ length: Math.min(size, 205 - start) }, (_, i) => ({ id: start + i + 1, titlePath: [`Result ${start + i + 1}`], file: 'test.spec.ts', browser: 'chromium', status: 'passed', retries: 0, issue: null }));
    return route.fulfill({ json: { items, nextCursor: start + size < 205 ? String(start + size) : null } });
  });
  await page.goto('/reports/runs/9999');
  await changeCursorSize(page, 100);
  await page.getByRole('button', { name: 'Trang sau', exact: true }).click();
  await expect(page.getByTestId('list-table').getByRole('row').nth(1).getByRole('cell').first()).toHaveText('101');
  await page.getByRole('button', { name: 'Trang sau', exact: true }).click();
  await expect(page.getByTestId('list-table').getByRole('row').nth(1).getByRole('cell').first()).toHaveText('201');
  await expect(page.getByText('Result 205', { exact: true })).toBeVisible();
});

test('test-case grid paginates and numbers rows in project and function views', async ({ page }) => {
  await page.route(/\/api\/v1\/projects\/ELMS\/test-cases(?:\?|$)/, (route) => {
    const p = new URL(route.request().url()).searchParams;
    const start = Number(p.get('cursor') ?? 0), size = Number(p.get('limit') ?? 200);
    return route.fulfill({ json: { items: Array.from({ length: Math.min(size, 115 - start) }, (_, i) => ({ id: start + i + 1, code: `CASE-${start + i + 1}`, title: `Test ${start + i + 1}`, priority: 'medium', status: 'not_started', categoryName: null, categoryId: null, stepCount: 0, bugs: [], version: 1, updatedAt: '2026-01-01' })), nextCursor: start + size < 115 ? String(start + size) : null } });
  });
  for (const suffix of ['', '?functionId=1']) {
    await page.goto(`/projects/ELMS/test-cases${suffix}`);
    const grid = page.getByTestId('tc-grid');
    await expect(grid.locator('.ag-row[row-index="0"] [col-id="stt"]')).toHaveText('1');
    await grid.locator('[aria-label="Next Page"]').click();
    await expect(grid.locator('.ag-row[row-index="10"] [col-id="stt"]')).toHaveText('11');
  }
});

test('test-case pagination reaches the next server block after200 rows', async ({ page }) => {
  const cursors: string[] = [];
  await page.route(/\/api\/v1\/projects\/ELMS\/test-cases(?:\?|$)/, (route) => {
    const p = new URL(route.request().url()).searchParams;
    const start = Number(p.get('cursor') ?? 0), size = Number(p.get('limit') ?? 200);
    if (p.has('cursor')) cursors.push(p.get('cursor')!);
    return route.fulfill({ json: { items: Array.from({ length: Math.min(size, 205 - start) }, (_, i) => ({ id: start + i + 1, code: `BLOCK-${start + i + 1}`, title: `Block test ${start + i + 1}`, priority: 'medium', status: 'not_started', categoryName: null, categoryId: null, stepCount: 0, bugs: [], version: 1, updatedAt: '2026-01-01' })), nextCursor: start + size < 205 ? String(start + size) : null } });
  });
  await page.goto('/projects/ELMS/test-cases');
  const grid = page.getByTestId('tc-grid');
  for (let current = 0; current <= 20; current++) {
    await expect(grid.locator(`.ag-row[row-index="${current * 10}"] [col-id="stt"]`)).toHaveText(String(current * 10 + 1));
    if (current < 20) await grid.locator('[aria-label="Next Page"]').click();
  }
  expect(cursors).toContain('200');
  await expect(grid.locator('[aria-label="Next Page"]')).toHaveAttribute('aria-disabled', 'true');
});
