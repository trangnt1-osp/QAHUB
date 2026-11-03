import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { PERMISSION_CATALOG, type Permission } from '@ospm/shared';
import { PermissionEditor } from './PermissionEditor';

function Harness({ disabled = false }: { disabled?: boolean }) {
  const [value, setValue] = useState<Permission[]>([]);
  return <PermissionEditor value={value} onChange={setValue} disabled={disabled} />;
}

describe('PermissionEditor', () => {
  it('starts compact and opens only the requested area', async () => {
    render(<Harness />);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Kiểm thử/ }));
    expect(await screen.findByRole('checkbox', { name: 'Thêm test case' })).toBeInTheDocument();
    expect(screen.getByText('Thêm test case', { exact: true })).toBeVisible();
    expect(screen.queryByRole('checkbox', { name: 'Thêm item' })).not.toBeInTheDocument();
  });

  it('searches Vietnamese without accents and shows an empty state', async () => {
    render(<Harness />);
    const search = screen.getByRole('textbox', { name: 'Tìm quyền' });
    fireEvent.change(search, { target: { value: 'xoa test case' } });
    expect(await screen.findByRole('checkbox', { name: 'Xóa test case' })).toBeInTheDocument();
    expect(screen.getByText('Xóa test case', { exact: true })).toBeVisible();
    expect(screen.queryByRole('checkbox', { name: 'Thêm test case' })).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'no-such-permission' } });
    expect(await screen.findByText('Không tìm thấy quyền phù hợp')).toBeVisible();
  });

  it('announces automatic prerequisites and removes dependent grants across areas', async () => {
    render(<Harness />);
    const search = screen.getByRole('textbox', { name: 'Tìm quyền' });
    fireEvent.change(search, { target: { value: 'Thêm test case' } });
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Thêm test case' }));
    expect(screen.getByRole('status')).toHaveTextContent('Tự bật thêm 2 quyền liên quan');
    expect(screen.getByTestId('permission-selection-count')).toHaveTextContent(`3/${PERMISSION_CATALOG.length}`);
    fireEvent.change(search, { target: { value: 'Xem menu Dự án' } });
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Xem menu Dự án' }));
    expect(screen.getByRole('status')).toHaveTextContent('Tự tắt thêm 2 quyền phụ thuộc');
    expect(screen.getByTestId('permission-selection-count')).toHaveTextContent(`0/${PERMISSION_CATALOG.length}`);
    fireEvent.change(search, { target: { value: 'Thêm test case' } });
    expect(await screen.findByRole('checkbox', { name: 'Thêm test case' })).not.toBeChecked();
  });

  it('keeps permissions disabled while saving', async () => {
    render(<Harness disabled />);
    fireEvent.click(screen.getByRole('button', { name: /Kiểm thử/ }));
    const checkbox = await screen.findByRole('checkbox', { name: 'Thêm test case' });
    expect(checkbox).toBeDisabled();
    expect(within(screen.getByTestId('permission-selection-count')).getByText(/0\//)).toBeVisible();
  });

  it('includes every catalog permission exactly once when all areas are open', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Mở tất cả' }));
    expect(await screen.findAllByRole('checkbox')).toHaveLength(PERMISSION_CATALOG.length);
    for (const entry of PERMISSION_CATALOG) expect(screen.getByText(entry.label, { exact: true })).toBeVisible();
  });
});
