import type { TableProps } from 'antd';
import { fmtNumber } from './number';

/** Preserve custom cell renderers and column behavior; localize only numeric output. */
export function formatTableNumbers<T extends object>(columns: NonNullable<TableProps<T>['columns']>): NonNullable<TableProps<T>['columns']> {
  return columns.map((column) => {
    if ('children' in column) return { ...column, children: formatTableNumbers(column.children) };
    const render = column.render;
    return { ...column, render: (value, record, index) => {
      const cell = render ? render(value, record, index) : value;
      return typeof cell === 'number' || typeof cell === 'bigint' ? fmtNumber(cell) : cell;
    } };
  });
}
