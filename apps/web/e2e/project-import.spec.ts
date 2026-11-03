import { expect, test, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { login } from './helpers';

const require = createRequire(import.meta.url);
const ExcelJS = require('../../api/node_modules/exceljs') as typeof import('../../api/node_modules/exceljs');
const mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
async function workbook(sheets: Record<string, (string | number)[][]>) {
  const book = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) book.addWorksheet(name).addRows(rows);
  return Buffer.from(await book.xlsx.writeBuffer());
}
async function upload(page: Page, sheets: Record<string, (string | number)[][]>) {
  await page.getByRole('button', { name: 'Import Excel', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('input[type=file]').setInputFiles({ name: 'project.xlsx', mimeType, buffer: await workbook(sheets) });
  await expect(dialog.getByRole('button', { name: 'Ghi dữ liệu', exact: true })).toBeVisible({ timeout: 30_000 });
  return dialog;
}

test('imports optional-Epic structure and linked Backlog only after preview; invalid references never write', async ({ page }) => {
  test.setTimeout(150_000);
  await login(page, 'admin@local.test', 'Admin@12345');
  const session = await (await page.request.post('/api/v1/auth/login', { data: { email: 'admin@local.test', password: 'Admin@12345' } })).json();
  const headers = { Authorization: `Bearer ${session.accessToken}` };
  const templates = await (await page.request.get('/api/v1/workflow-templates', { headers })).json();
  expect((await page.request.post('/api/v1/projects', { headers, data: { key: 'IMPUI', name: 'Import UI', workflowTemplateId: templates.find((row: { name: string }) => row.name === 'Tối giản').id } })).ok()).toBeTruthy();
  const metadata = async () => (await page.request.get('/api/v1/projects/IMPUI/structure/options', { headers })).json();
  await page.goto('/projects/IMPUI/structure');
  await page.getByRole('button', { name: 'Import Excel', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /Tải mẫu Excel/ }).click();
  expect((await download).suggestedFilename()).toBe('IMPUI-module-import.xlsx');
  await page.getByRole('dialog').getByRole('button', { name: 'Đóng', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Forward references and Module -> Function work without an Epic.
  let dialog = await upload(page, {
    Functions: [['code', 'name', 'moduleCode'], ['FN-IMPORT', 'Search customers', 'MOD-IMPORT']],
    Modules: [['code', 'name'], ['MOD-IMPORT', 'Customers']],
  });
  expect((await metadata()).modules).toHaveLength(0);
  await expect(dialog.getByRole('button', { name: 'Ghi dữ liệu', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Ghi dữ liệu', exact: true }).click();
  await expect(dialog.getByText('Đã nhập dữ liệu thành công', { exact: true })).toBeVisible({ timeout: 30_000 });
  let structure = await metadata();
  expect(structure.epics).toHaveLength(0);
  expect(structure.functions[0].moduleId).toBe(structure.modules[0].id);
  await dialog.getByRole('button', { name: 'Đóng', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: 'MOD-IMPORT' })).toContainText('Customers');

  dialog = await upload(page, { Functions: [['code', 'name', 'moduleCode'], ['FN-INVALID', 'Invalid', 'MISSING']] });
  await expect(dialog.getByRole('button', { name: 'Ghi dữ liệu', exact: true })).toBeDisabled();
  expect((await metadata()).functions).toHaveLength(1);
  await dialog.getByRole('button', { name: 'Đóng', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  await page.goto('/projects/IMPUI/backlog');
  dialog = await upload(page, {
    Backlog: [
      ['ref', 'type', 'title', 'parent', 'epicCode', 'functionCodes'],
      ['child', 'subtask', 'Imported subtask', 'parent', '', ''],
      ['parent', 'task', 'Imported task', '', 'EP-IMPORT', 'FN-IMPORT'],
    ],
    Epics: [['code', 'name', 'moduleCodes'], ['EP-IMPORT', 'Import goal', 'MOD-IMPORT']],
  });
  expect((await metadata()).epics).toHaveLength(0);
  await dialog.getByRole('button', { name: 'Ghi dữ liệu', exact: true }).click();
  await expect(dialog.getByText('Đã nhập dữ liệu thành công', { exact: true })).toBeVisible({ timeout: 30_000 });
  structure = await metadata();
  expect(structure.epics).toHaveLength(1);
  await dialog.getByRole('button', { name: 'Đóng', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('backlog-scroll')).toContainText('Imported task');
  const issues = await (await page.request.get('/api/v1/projects/IMPUI/issues?limit=100', { headers })).json();
  const rows = Array.isArray(issues) ? issues : issues.items ?? issues.data;
  const task = rows.find((row: { title: string }) => row.title === 'Imported task');
  const child = rows.find((row: { title: string }) => row.title === 'Imported subtask');
  const detail = await (await page.request.get(`/api/v1/issues/${task.key}`, { headers })).json();
  expect(detail.parent.id).toBe(structure.epics[0].id);
  expect(detail.functionIds).toEqual([structure.functions[0].id]);
  expect(detail.moduleIds).toEqual([structure.modules[0].id]);
  const childDetail = await (await page.request.get(`/api/v1/issues/${child.key}`, { headers })).json();
  expect(childDetail.parent.id).toBe(task.id);
});
