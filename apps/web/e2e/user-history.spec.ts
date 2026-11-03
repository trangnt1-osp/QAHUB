import { expect, test } from '@playwright/test';
import { login } from './helpers';

let adminToken: string;
let userId: number;

test.beforeAll(async ({ request }) => {
  const loggedIn = await request.post('http://localhost:3100/api/v1/auth/login', { data: { email: 'admin@local.test', password: 'Admin@12345' } });
  adminToken = (await loggedIn.json()).accessToken;
  const headers = { Authorization: `Bearer ${adminToken}` };
  const user = await request.post('http://localhost:3100/api/v1/users', {
    headers, data: { email: 'profile@local.test', displayName: 'Profile User', systemRole: 'member', password: 'Password1!' },
  });
  expect(user.ok()).toBeTruthy();
  userId = (await user.json()).id;
  for (const [path, data] of [
    ['/members', { userId, role: 'developer', joinedAt: '2026-01-01' }],
    [`/members/${userId}/leave`, { leftAt: '2026-01-02' }],
    ['/members', { userId, role: 'viewer', joinedAt: '2026-02-01' }],
  ] as const) {
    const res = await request.post(`http://localhost:3100/api/v1/projects/ELMS${path}`, { headers, data });
    expect(res.ok()).toBeTruthy();
  }
  const empty = await request.post('http://localhost:3100/api/v1/users', {
    headers, data: { email: 'empty-history@local.test', displayName: 'Empty History', systemRole: 'member', password: 'Password1!' },
  });
  expect(empty.ok()).toBeTruthy();
});

test.beforeEach(async ({ page }) => {
  await login(page, 'admin@local.test', 'Admin@12345');
  await page.goto('/members');
});

test('view user shows each project participation period and refreshes on reopening', async ({ page, request }) => {
  const view = page.getByRole('row').filter({ hasText: 'profile@local.test' }).getByRole('button', { name: 'Xem', exact: true });
  await view.click();
  const drawer = page.getByRole('dialog', { name: 'Thông tin người dùng' });
  await expect(drawer.getByLabel('Tên hiển thị')).toHaveValue('Profile User');
  await expect(drawer.getByRole('heading', { name: 'Lịch sử dự án tham gia' })).toBeVisible();
  const periods = drawer.getByRole('row').filter({ hasText: 'ELMS' });
  await expect(periods).toHaveCount(2);
  await expect(periods.filter({ hasText: 'Đã rời' })).toContainText('01/01/2026');
  await expect(periods.filter({ hasText: 'Đã rời' })).toContainText('02/01/2026');
  await expect(periods.filter({ hasText: 'Đang tham gia' })).toContainText('01/02/2026');
  await expect(periods.filter({ hasText: 'Đang tham gia' })).toContainText('viewer');
  await page.keyboard.press('Escape');
  await expect(drawer).not.toBeVisible();
  const departed = await request.post(`http://localhost:3100/api/v1/projects/ELMS/members/${userId}/leave`, {
    headers: { Authorization: `Bearer ${adminToken}` }, data: { leftAt: '2026-02-02' },
  });
  expect(departed.ok()).toBeTruthy();
  await view.click();
  await expect(drawer.getByText('Đang tham gia', { exact: true })).toHaveCount(0);
  await expect(drawer.getByText('Đã rời', { exact: true })).toHaveCount(2);
  await expect(drawer.getByText('02/02/2026', { exact: true })).toBeVisible();
});

test('view handles empty history, switching users and opening project information', async ({ page }) => {
  await page.getByRole('row').filter({ hasText: 'empty-history@local.test' }).getByRole('button', { name: 'Xem', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Thông tin người dùng' });
  await expect(drawer.getByText('Chưa tham gia dự án nào')).toBeVisible();
  await expect(drawer.getByLabel('Tên hiển thị')).toHaveValue('Empty History');
  await page.keyboard.press('Escape');
  await expect(drawer).not.toBeVisible();
  await page.getByRole('row').filter({ hasText: 'profile@local.test' }).getByRole('button', { name: 'Xem', exact: true }).click();
  await expect(drawer.getByLabel('Tên hiển thị')).toHaveValue('Profile User');
  await drawer.getByRole('link', { name: 'ELMS', exact: true }).first().click();
  await expect(page).toHaveURL(/\/projects\/ELMS\/info$/);
  await expect(drawer).not.toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Ngày tham gia dự án', exact: true })).toBeVisible();
});
