import { fireEvent, render, screen, within } from '@testing-library/react';
import { ListTable } from './ListTable';

const rows = Array.from({ length: 23 }, (_, index) => ({ id: index + 1, name: `Item ${index + 1}` }));
const columns = [{ title: 'Name', dataIndex: 'name', sorter: (a: { id: number }, b: { id: number }) => a.id - b.id }];

it('formats numeric cells without changing values used by sorting and custom cells', () => {
  render(<ListTable rowKey="id" dataSource={[{ id: 1, name: 'ELMS-1234', count: 1234.5 }]} columns={[
    { title: 'Code', dataIndex: 'name' },
    { title: 'Count', dataIndex: 'count' },
    { title: 'Custom', render: () => <button>Keep action</button> },
    { title: 'Hidden', dataIndex: 'count', render: () => null },
  ]} />);
  expect(screen.getByText('1.234,5')).toBeInTheDocument();
  expect(screen.getByText('ELMS-1234')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Keep action' })).toBeInTheDocument();
});

// jsdom has no pseudo-element layout; rc-table only uses it to measure scrollbar size.
const computedStyle = window.getComputedStyle.bind(window);
beforeAll(() => { vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => computedStyle(element)); });
afterAll(() => { vi.restoreAllMocks(); });

it('paginates the full list and continues STT on later pages', () => {
  render(<ListTable rowKey="id" dataSource={rows} columns={columns} />);
  expect(screen.getByRole('columnheader', { name: 'STT' })).toBeInTheDocument();
  expect(screen.getByText('Item 1')).toBeInTheDocument();
  expect(screen.queryByText('Item 11')).not.toBeInTheDocument();
  fireEvent.click(screen.getByTitle('2'));
  const first = screen.getAllByRole('row')[1];
  expect(within(first).getAllByRole('cell')[0]).toHaveTextContent('11');
  expect(within(first).getByText('Item 11')).toBeInTheDocument();
  fireEvent.click(screen.getByTitle('3'));
  expect(within(screen.getAllByRole('row')[1]).getAllByRole('cell')[0]).toHaveTextContent('21');
});

it('clamps the page when items are removed and resets when the list context changes', () => {
  const { rerender } = render(<ListTable rowKey="id" dataSource={rows} columns={columns} resetKey="A" />);
  fireEvent.click(screen.getByTitle('3'));
  rerender(<ListTable rowKey="id" dataSource={rows.slice(0, 11)} columns={columns} resetKey="A" />);
  expect(screen.getByText('Item 11')).toBeInTheDocument();
  rerender(<ListTable rowKey="id" dataSource={rows} columns={columns} resetKey="B" />);
  expect(screen.getByText('Item 1')).toBeInTheDocument();
  expect(screen.queryByText('Item 11')).not.toBeInTheDocument();
  rerender(<ListTable rowKey="id" dataSource={rows} columns={columns} resetKey="A" />);
  expect(screen.getByText('Item 1')).toBeInTheDocument();
});

it('numbers a cursor page using its true offset without slicing it again', () => {
  render(<ListTable rowKey="id" dataSource={rows.slice(10, 20)} columns={columns}
    cursorPage={{ current: 2, pageSize: 10, hasNext: true, onPrevious: () => undefined, onNext: () => undefined, onPageSizeChange: () => undefined }} />);
  expect(within(screen.getAllByRole('row')[1]).getAllByRole('cell')[0]).toHaveTextContent('11');
  expect(screen.getByText('Item 20')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Trang trước' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Trang sau' })).toBeEnabled();
});
