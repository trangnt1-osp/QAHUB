import { expect, test } from '@playwright/test';
import { login } from './helpers';

test.use({ actionTimeout: 15_000 });

test('permission editor stays compact, searches without accents and explains dependency changes on desktop and mobile', async ({ page }) => {
  await login(page, 'admin@local.test', 'Admin@12345');
  await page.goto('/roles');
  await page.getByRole('button', { name: /Thêm vai trò/ }).click();
  const drawer = page.getByRole('dialog');
  const search = drawer.getByRole('textbox', { name: 'Tìm quyền', exact: true });
  await expect(drawer.getByRole('checkbox')).toHaveCount(0);
  for (const name of ['Tổng quan', 'Dự án', 'Công việc', 'Kiểm thử', 'Cấu hình', 'Tích hợp & báo cáo']) {
    await expect(drawer.getByRole('button', { name: new RegExp(name) })).toBeVisible();
  }
  await page.screenshot({ path: '../../var/role-permissions-desktop.png', animations: 'disabled' });
  await search.fill('them test case');
  await drawer.getByRole('checkbox', { name: 'Thêm test case', exact: true }).check();
  await expect(drawer.getByRole('status')).toContainText('Tự bật thêm 2 quyền liên quan');
  await expect(drawer.getByTestId('permission-selection-count')).toContainText('3/');
  await search.fill('khong-co-quyen-nay');
  await expect(drawer.getByText('Không tìm thấy quyền phù hợp', { exact: true })).toBeVisible();
  await search.fill('Xem menu Dự án');
  await drawer.getByRole('checkbox', { name: 'Xem menu Dự án', exact: true }).uncheck();
  await expect(drawer.getByRole('status')).toContainText('Tự tắt thêm 2 quyền phụ thuộc');
  await expect(drawer.getByTestId('permission-selection-count')).toContainText('0/');
  await search.fill('');
  await drawer.getByRole('button', { name: 'Mở tất cả', exact: true }).click();
  await expect(drawer.getByRole('checkbox', { name: 'Bỏ qua quy tắc chuyển trạng thái', exact: true })).toBeVisible();
  await drawer.getByRole('button', { name: 'Thu gọn', exact: true }).click();
  await expect(drawer.getByRole('checkbox')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await search.fill('Import');
  await expect(drawer.getByRole('checkbox')).toHaveCount(1);
  await drawer.getByRole('checkbox').check();
  await expect(drawer.getByRole('button', { name: 'Lưu', exact: true })).toBeVisible();
  await expect.poll(async () => (await drawer.boundingBox())!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: '../../var/role-permissions-mobile.png', animations: 'disabled' });
  await drawer.getByRole('button', { name: 'Hủy', exact: true }).click();
  await expect(drawer).toHaveCount(0);
});
