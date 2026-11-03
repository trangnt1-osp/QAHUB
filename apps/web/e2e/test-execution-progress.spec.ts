import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('execution percentages and total counts agree and refresh after drawer and grid status changes', async ({ page }) => {
  await login(page, 'admin@local.test', 'Admin@12345');
  const session = await (await page.request.post('/api/v1/auth/login', { data: { email: 'admin@local.test', password: 'Admin@12345' } })).json();
  const headers = { Authorization: `Bearer ${session.accessToken}` };
  const fnResponse = await page.request.post('/api/v1/projects/ELMS/requirements', { headers, data: { kind: 'function', code: 'EXEC-BROWSER', name: 'Execution progress' } });
  expect(fnResponse.ok()).toBeTruthy();
  const fn = await fnResponse.json();
  let failed: { id: number; code: string } | undefined;
  for (const status of ['passed', 'failed', 'blocked', 'na', 'not_started']) {
    const response = await page.request.post('/api/v1/projects/ELMS/test-cases', { headers, data: { functionId: fn.id, title: `Progress ${status}`, status } });
    expect(response.ok()).toBeTruthy();
    if (status === 'failed') failed = await response.json();
  }
  await page.goto(`/projects/ELMS/test-cases?functionId=${fn.id}`);
  await page.getByPlaceholder('Tìm mã/tên function').fill('EXEC-BROWSER');
  const node = page.getByRole('treeitem').filter({ has: page.getByText('EXEC-BROWSER · Execution progress', { exact: true }) }).last();
  const summary = page.getByTestId('checklist-summary');
  await expect(node).toContainText('5 TC');
  await expect(node).toContainText('40%');
  await expect(summary).toContainText('40%');
  await page.getByText(failed!.code, { exact: true }).click();
  const drawer = page.getByRole('dialog');
  await drawer.getByLabel('Status', { exact: true }).press('ArrowDown');
  await page.locator('.ant-select-dropdown:visible').getByText('Not Started', { exact: true }).click();
  await drawer.getByRole('button', { name: /Lưu$/ }).click();
  await expect(summary).toContainText('20%');
  await drawer.getByRole('button', { name: 'Đóng', exact: true }).click();
  await expect(node).toContainText('20%');
  const statusCell = page.locator(`.ag-center-cols-container .ag-row[row-id="${failed!.id}"] [col-id="status"]`);
  await statusCell.dblclick();
  await page.keyboard.press('ArrowDown');
  await page.getByRole('option', { name: 'passed', exact: true }).click();
  await expect(statusCell).toContainText('Passed');
  await expect(summary).toContainText('40%');
  await expect(node).toContainText('40%');
  await expect(node).toContainText('5 TC');
});
