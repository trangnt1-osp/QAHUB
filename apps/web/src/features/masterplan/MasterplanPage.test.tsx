import { App } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import { http } from '../../api/http';
import { useAuth } from '../auth/authStore';
import MasterplanPage from './MasterplanPage';

const milestone = { id: 1, name: 'Release Login', startDate: '2026-01-01', endDate: '2026-01-31', status: 'in_progress', progress: 40, acceptanceCriteria: 'All login tests pass', notes: '', version: 1, ownerId: 7, owner: { id: 7, displayName: 'QA Lead' }, features: [{ id: 9, code: 'LOGIN', name: 'Login' }] };
function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<App><QueryClientProvider client={client}><MemoryRouter initialEntries={['/projects/DEMO/masterplan']}><Routes><Route path="/projects/:projectKey/masterplan" element={<MasterplanPage />} /></Routes></MemoryRouter></QueryClientProvider></App>);
}
describe('MasterplanPage', () => {
  beforeEach(() => {
    const original = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation(el => original(el));
    useAuth.setState({ user: { id: 1, email: 'admin@local.test', displayName: 'Admin', avatarUrl: null, systemRole: 'admin' }, ready: true, projects: [] });
    vi.spyOn(http, 'get').mockImplementation(async url => ({ data: String(url).endsWith('/options') ? { owners: [{ id: 7, displayName: 'QA Lead' }], features: milestone.features } : [milestone] }) as never);
  });
  afterEach(() => vi.restoreAllMocks());
  it('shows milestone dates, linked features, manual progress and overdue state', async () => {
    renderPage();
    expect(await screen.findByText('Release Login')).toBeInTheDocument();
    expect(screen.getByText('LOGIN')).toBeInTheDocument();
    expect(screen.getByText('All login tests pass')).toBeInTheDocument();
    expect(screen.getAllByText('Quá hạn').length).toBeGreaterThan(0);
    expect(screen.getByText('40%')).toBeInTheDocument();
  });
  it('edits only the selected milestone using its version', async () => {
    const patch = vi.spyOn(http, 'patch').mockResolvedValue({ data: milestone });
    renderPage();
    fireEvent.click(await screen.findByLabelText('Sửa mốc Release Login'));
    const dialog = await screen.findByRole('dialog', { name: 'Sửa mốc kế hoạch' });
    fireEvent.change(within(dialog).getByLabelText('Tên mốc'), { target: { value: 'Release Login v2' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/api/v1/projects/DEMO/masterplan/1', expect.objectContaining({ name: 'Release Login v2', version: 1, featureIds: [9] })));
  });
  it('allows viewers to read but hides mutation controls', async () => {
    useAuth.setState({ user: { id: 2, email: 'viewer@local.test', displayName: 'Viewer', avatarUrl: null, systemRole: 'member' }, projects: [{ key: 'DEMO', role: 'viewer', permissions: ['project.view', 'project.info.view'] }] as never });
    renderPage();
    expect(await screen.findByText('Release Login')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Thêm mốc' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Sửa mốc Release Login')).not.toBeInTheDocument();
  });
  it('refreshes stale milestone data after an edit conflict', async () => {
    vi.spyOn(http, 'patch').mockRejectedValue({ response: { status: 409 } });
    const get = vi.mocked(http.get);
    renderPage();
    fireEvent.click(await screen.findByLabelText('Sửa mốc Release Login'));
    const dialog = await screen.findByRole('dialog', { name: 'Sửa mốc kế hoạch' });
    const before = get.mock.calls.filter(([url]) => String(url).endsWith('/masterplan')).length;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(get.mock.calls.filter(([url]) => String(url).endsWith('/masterplan')).length).toBeGreaterThan(before));
  });
});
