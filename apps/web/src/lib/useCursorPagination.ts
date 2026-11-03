import { useState } from 'react';

/** Retain visited cursors; filters and page-size changes start a fresh traversal. */
export function useCursorPagination(scope: string) {
  const [stored, setStored] = useState<{ scope: string; current: number; pageSize: number; cursors: (string | undefined)[] }>({ scope, current: 1, pageSize: 10, cursors: [undefined] });
  const state = stored.scope === scope ? stored : { scope, current: 1, pageSize: stored.pageSize, cursors: [undefined] };
  if (stored.scope !== scope) setStored(state);
  return {
    current: state.current,
    pageSize: state.pageSize,
    cursor: state.cursors[state.current - 1],
    previous: () => setStored({ ...state, current: Math.max(1, state.current - 1) }),
    next: (cursor: string | null | undefined) => {
      if (cursor) setStored({ ...state, current: state.current + 1, cursors: [...state.cursors.slice(0, state.current), cursor] });
    },
    setPageSize: (pageSize: number) => setStored({ scope, current: 1, pageSize, cursors: [undefined] }),
  };
}
