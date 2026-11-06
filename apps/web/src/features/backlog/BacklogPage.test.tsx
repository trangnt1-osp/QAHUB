import { App } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import BacklogPage from './BacklogPage';

const getBacklog = vi.hoisted(() => vi.fn());
vi.mock('../../api/generated/api', async () => ({
  ...(await vi.importActual('../../api/generated/api')), getBacklog,
}));
vi.mock('../../api/hooks', () => ({
  useMembers: () => ({ data: [] }), useWorkflow: () => ({ data: { statuses: [] } }),
  useSprints: () => ({ data: [] }), useProjectTracking: () => 'sprint',
  useLabels: () => ({ data: [] }),
}));
vi.mock('../project-structure', () => ({ useProjectStructure: () => ({ data: { epics: [], modules: [], functions: [] } }) }));
vi.mock('../project-import', () => ({ ProjectImportButton: () => null }));
vi.mock('../issues/useSelectedIssue', () => ({ useSelectedIssue: () => ({ select: vi.fn() }) }));

function renderBacklog(fixedType?: 'bug') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<App><QueryClientProvider client={client}><MemoryRouter initialEntries={['/projects/DEMO/bugs?type=task&priority=high']}>
    <Routes><Route path="/projects/:projectKey/bugs" element={<BacklogPage fixedType={fixedType} />} /></Routes>
  </MemoryRouter></QueryClientProvider></App>);
}

beforeEach(() => { getBacklog.mockResolvedValue({ sprints: [], backlog: { issues: [], total: 0, nextCursor: null } }); });
afterEach(() => vi.clearAllMocks());

it('enforces Bug over a conflicting URL type and retains it when clearing filters', async () => {
  renderBacklog('bug');
  await waitFor(() => expect(getBacklog).toHaveBeenCalledWith('DEMO', expect.objectContaining({ type: ['bug'], priority: ['high'] })));
  fireEvent.click(await screen.findByText('Clear filters'));
  await waitFor(() => expect(getBacklog).toHaveBeenLastCalledWith('DEMO', { type: ['bug'], limit: 100 }));
  expect(screen.queryByText('Clear filters')).not.toBeInTheDocument();
});

it('keeps the normal Backlog type filter from the URL', async () => {
  renderBacklog();
  await waitFor(() => expect(getBacklog).toHaveBeenCalledWith('DEMO', expect.objectContaining({ type: ['task'] })));
});
