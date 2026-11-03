import { List } from 'antd';
import type { ListProps } from 'antd/es/list';
import { useState, type ReactNode } from 'react';
import { LIST_PAGE_SIZES } from './ListTable';

export function NumberedList<T>({ dataSource = [], renderItem, resetKey = '', ...props }: Omit<ListProps<T>, 'pagination' | 'renderItem'> & {
  resetKey?: string; renderItem: (item: T, index: number) => ReactNode;
}) {
  const [state, setState] = useState({ key: resetKey, current: 1, pageSize: 10 });
  const current = Math.min(state.key === resetKey ? state.current : 1, Math.max(1, Math.ceil(dataSource.length / state.pageSize)));
  if (state.key !== resetKey || state.current !== current) setState({ ...state, key: resetKey, current });
  return <List<T> {...props} dataSource={dataSource} renderItem={(item, index) => renderItem(item, (current - 1) * state.pageSize + index)}
    pagination={{ current, pageSize: state.pageSize, showSizeChanger: true, pageSizeOptions: LIST_PAGE_SIZES,
      showTotal: (total, range) => `${range[0]}–${range[1]} / ${total}`,
      onChange: (page, pageSize) => setState({ key: resetKey, current: pageSize !== state.pageSize ? 1 : page, pageSize }),
    }} />;
}
