import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { EmptyState } from '../../components/EmptyState';

/** Preserve existing search links while showing results in the project backlog. */
export function IssueSearchPage() {
  const [params] = useSearchParams();
  const loc = useLocation();
  const term = (params.get('q') ?? '').trim().toUpperCase();
  const match = /^([A-Z][A-Z0-9]+)-\d+$/.exec(term);
  if (match) return <Navigate replace to={`/projects/${match[1]}/backlog?${new URLSearchParams({ q: term })}`} state={loc.state} />;
  return <div className="page"><EmptyState title="Nhập mã item đúng định dạng, ví dụ ELMS-2249." /></div>;
}
