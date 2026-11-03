import { Button, Select, Space, Table, type TableProps } from 'antd';
import { useState } from 'react';
import { fmtNumber } from '../lib/number';
import { formatTableNumbers } from '../lib/tableNumbers';

export const LIST_PAGE_SIZES = [10, 20, 50, 100];

export interface CursorPage {
  current: number;
  pageSize: number;
  hasNext: boolean;
  pending?: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onPageSizeChange: (size: number) => void;
}

type Props<T extends object> = Omit<TableProps<T>, 'pagination'> & { resetKey?: string; cursorPage?: CursorPage; listPage?: { current: number; pageSize: number; onChange: (current: number, pageSize: number) => void } };

/** Shared numbering and pagination for full lists and server cursor pages. */
export function ListTable<T extends object>({ columns = [], dataSource = [], resetKey = '', cursorPage, listPage, onChange, ...props }: Props<T>) {
  const [state, setState] = useState({ key: resetKey, current: 1, pageSize: 10 });
  const pageSize = cursorPage?.pageSize ?? listPage?.pageSize ?? state.pageSize;
  const current = cursorPage?.current ?? Math.min(listPage?.current ?? (state.key === resetKey ? state.current : 1), Math.max(1, Math.ceil(dataSource.length / pageSize)));
  if (state.key !== resetKey || (!cursorPage && state.current !== current)) {
    setState({ key: resetKey, current: cursorPage ? 1 : current, pageSize: state.pageSize });
  }
  const start = (current - 1) * pageSize;
  return <div data-testid="list-table">
    <Table<T> {...props} dataSource={dataSource} columns={formatTableNumbers<T>([
      { title: 'STT', key: '__serial', width: 64, align: 'center', fixed: props.scroll?.x ? 'left' : undefined,
        render: (_value, _row, index) => start + index + 1 },
      ...columns,
    ])} pagination={cursorPage ? false : {
      current, pageSize, showSizeChanger: true, pageSizeOptions: LIST_PAGE_SIZES,
      showTotal: (total, range) => `${fmtNumber(range[0])}–${fmtNumber(range[1])} / ${fmtNumber(total)}`,
      itemRender: (page, type, original) => type === 'page' ? fmtNumber(page) : original,
    }} onChange={(pagination, filters, sorter, extra) => {
      const size = pagination.pageSize ?? pageSize;
      listPage?.onChange(extra.action !== 'paginate' || size !== pageSize ? 1 : pagination.current ?? 1, size);
      setState({ key: resetKey, pageSize: size, current: extra.action !== 'paginate' || size !== pageSize ? 1 : pagination.current ?? 1 });
      onChange?.(pagination, filters, sorter, extra);
    }} />
    {cursorPage && <Space wrap style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 0' }}>
      <span>{dataSource.length ? `${fmtNumber(start + 1)}–${fmtNumber(start + dataSource.length)} · ` : ''}Trang {fmtNumber(current)}</span>
      <Button aria-label="Trang trước" disabled={current === 1 || cursorPage.pending} onClick={cursorPage.onPrevious}>Trước</Button>
      <Button aria-label="Trang sau" disabled={!cursorPage.hasNext || cursorPage.pending} onClick={cursorPage.onNext}>Sau</Button>
      <Select aria-label="Số dòng mỗi trang" value={pageSize} disabled={cursorPage.pending} onChange={cursorPage.onPageSizeChange}
        options={LIST_PAGE_SIZES.map((size) => ({ value: size, label: `${size} / trang` }))} />
    </Space>}
  </div>;
}
