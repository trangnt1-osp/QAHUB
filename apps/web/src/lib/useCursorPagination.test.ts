import { act, renderHook } from '@testing-library/react';
import { useCursorPagination } from './useCursorPagination';

it('navigates visited cursors and drops them when context or size changes', () => {
  const { result, rerender } = renderHook(({ scope }) => useCursorPagination(scope), { initialProps: { scope: 'A' } });
  act(() => result.current.next('after-10'));
  expect(result.current).toMatchObject({ current: 2, pageSize: 10, cursor: 'after-10' });
  act(() => result.current.next('after-20'));
  act(() => result.current.previous());
  expect(result.current.cursor).toBe('after-10');
  rerender({ scope: 'B' });
  expect(result.current).toMatchObject({ current: 1, cursor: undefined });
  rerender({ scope: 'A' });
  expect(result.current).toMatchObject({ current: 1, cursor: undefined });
  act(() => result.current.next('B-cursor'));
  act(() => result.current.setPageSize(20));
  expect(result.current).toMatchObject({ current: 1, pageSize: 20, cursor: undefined });
});
