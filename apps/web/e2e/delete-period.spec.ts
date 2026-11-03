import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('delete checks fresh item links before showing a warning or ordinary confirmation', async ({ page }) => {
  await login(page, 'admin@local.test', 'Admin@12345');
  const session = await (await page.request.post('/api/v1/auth/login', { data: { email: 'admin@local.test', password: 'Admin@12345' } })).json();
  const headers = { Authorization: `Bearer ${session.accessToken}` };
  const templates = await (await page.request.get('/api/v1/workflow-templates', { headers })).json();
  const project = await page.request.post('/api/v1/projects', { headers, data: { key: 'DELCHECK', name: 'Delete check', workflowTemplateId: templates[0].id } });
  expect(project.ok()).toBeTruthy();
  const linked = await (await page.request.post('/api/v1/projects/DELCHECK/sprints', { headers, data: { name: 'Linked sprint' } })).json();
  const empty = await (await page.request.post('/api/v1/projects/DELCHECK/sprints', { headers, data: { name: 'Empty sprint' } })).json();
  await page.goto('/projects/DELCHECK/backlog');
  await expect(page.getByTestId(`period-header-${linked.id}`)).toBeVisible();
  // Another client allocates after the Backlog and its cached counts have loaded.
  const issue = await page.request.post('/api/v1/projects/DELCHECK/issues', { headers, data: { title: 'Newly linked task', type: 'task', sprintId: linked.id } });
  expect(issue.ok()).toBeTruthy();
  let deleteRequests = 0;
  page.on('request', (request) => { if (request.method() === 'DELETE' && request.url().includes('/sprints/')) deleteRequests++; });
  await page.getByRole('button', { name: 'Thao tác Linked sprint', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Xóa sprint', exact: true }).click();
  const warning = page.getByRole('dialog');
  await expect(warning).toContainText('Không thể xóa sprint');
  await expect(warning).toContainText('Còn 1 item liên kết');
  await expect(warning.getByRole('button', { name: 'Xóa', exact: true })).toHaveCount(0);
  expect(deleteRequests).toBe(0);
  await warning.getByRole('button', { name: 'Đã hiểu', exact: true }).click();
  await page.getByRole('button', { name: 'Thao tác Empty sprint', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Xóa sprint', exact: true }).click();
  const confirm = page.getByRole('dialog');
  await expect(confirm).toContainText('Xóa Empty sprint?');
  await expect(confirm).not.toContainText('item liên kết');
  await confirm.getByRole('button', { name: 'Xóa', exact: true }).click();
  await expect(page.getByText('Đã xóa sprint', { exact: true })).toBeVisible();
  await expect(page.getByTestId(`period-header-${empty.id}`)).toHaveCount(0);
  expect(deleteRequests).toBe(1);
});
