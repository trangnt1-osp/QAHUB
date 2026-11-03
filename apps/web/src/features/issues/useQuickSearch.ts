import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

interface SearchSession { from: string; term: string; pathname: string }

/** Keep the original screen while replacing successive quick-search results. */
export function useQuickSearch() {
  const loc = useLocation();
  const nav = useNavigate();
  const session = useRef<SearchSession | null>(null);
  const [value, setValue] = useState('');
  useEffect(() => {
    const saved = loc.state?.quickSearch as SearchSession | undefined;
    const candidate = saved ?? session.current;
    const term = new URLSearchParams(loc.search).get('q');
    if (candidate && candidate.pathname === loc.pathname && candidate.term === term) {
      session.current = candidate;
      setValue(candidate.term);
    } else {
      session.current = null;
      setValue('');
    }
  }, [loc.key, loc.pathname, loc.search, loc.state]);
  return {
    value,
    onChange: (next: string) => {
      setValue(next);
      if (!next && session.current) {
        const from = session.current.from;
        session.current = null;
        nav(from, { replace: true });
      }
    },
    onSearch: (input: string) => {
      const term = input.trim().toUpperCase();
      if (!term) return;
      const match = /^([A-Z][A-Z0-9]+)-\d+$/.exec(term);
      const pathname = match ? `/projects/${match[1]}/backlog` : '/search';
      const previous = session.current;
      const next = { from: previous?.from ?? loc.pathname + loc.search + loc.hash, term, pathname };
      session.current = next;
      setValue(term);
      nav(`${pathname}?${new URLSearchParams({ q: term })}`, { replace: !!previous, state: { quickSearch: next } });
    },
  };
}
