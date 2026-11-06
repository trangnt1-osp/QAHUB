import { App } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import { BugRecognition } from './BugRecognition';

const get = vi.hoisted(() => vi.fn());
vi.mock('../../api/http', () => ({ http: { get } }));

const result = {
  period: 'week', from: '2026-11-01T17:00:00.000Z', to: '2026-11-08T17:00:00.000Z', total: 7,
  items: [
    { user: { id: 1, displayName: 'Nguyễn An', avatarUrl: null }, count: 3, rank: 1 },
    { user: { id: 2, displayName: 'Trần Bình', avatarUrl: null }, count: 3, rank: 1 },
    { user: { id: 3, displayName: 'Lê Chi', avatarUrl: null }, count: 1, rank: 3 },
  ],
  rejected: { total: 2, items: [{ user: { id: 4, displayName: 'Phạm Dũng', avatarUrl: null }, count: 2 }] },
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<App><QueryClientProvider client={client}><MemoryRouter initialEntries={['/projects/DEMO/bugs']}><Routes>
    <Route path="/projects/:projectKey/bugs" element={<BugRecognition projectKey="DEMO" />} />
  </Routes></MemoryRouter></QueryClientProvider></App>);
}

describe('BugRecognition', () => {
  beforeEach(() => get.mockResolvedValue({ data: result }));
  afterEach(() => vi.clearAllMocks());

  it('honors tied champions and shows the Vietnam date range and counting rules', async () => {
    renderPage();
    expect(await screen.findByText('Bảng xếp hạng')).toBeInTheDocument();
    expect(screen.getAllByText('Đồng hạng nhất', { exact: true })).toHaveLength(2);
    expect(screen.getAllByText('Nguyễn An').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Trần Bình').length).toBeGreaterThan(0);
    expect(screen.getByText(/02\/11\/2026.*08\/11\/2026/)).toBeInTheDocument();
    expect(screen.getByText(/Không tính.*trùng.*từ chối.*tự động/)).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/api/v1/projects/DEMO/bug-contributors', expect.objectContaining({ params: expect.objectContaining({ period: 'week' }) }));
  });

  it('requests a calendar month independently of the bug report filters', async () => {
    renderPage();
    await screen.findByText('Bảng xếp hạng');
    fireEvent.click(screen.getByText('Tháng'));
    await waitFor(() => expect(get).toHaveBeenLastCalledWith('/api/v1/projects/DEMO/bug-contributors', { params: { period: 'month', date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) } }));
  });

  it('shows a friendly rejected-bug reminder beside the recognition section', async () => {
    renderPage();
    const reminder = await screen.findByRole('region', { name: 'Góc nhắc nhẹ' });
    expect(within(reminder).getByText('Phạm Dũng')).toBeInTheDocument();
    expect(within(reminder).getByText('2 bug bị từ chối')).toBeInTheDocument();
    expect(within(reminder).getByText(/Bug quay về.*manh mối/)).toBeInTheDocument();
    expect(within(reminder).queryByText('Hạng nhất')).not.toBeInTheDocument();
    expect(screen.getByText('Bảng xếp hạng')).toBeInTheDocument();
  });

  it('still shows reminders when there are no valid bugs to honor', async () => {
    get.mockResolvedValue({ data: { ...result, total: 0, items: [] } });
    renderPage();
    expect(await screen.findByText('Chưa có bug hợp lệ trong kỳ này')).toBeInTheDocument();
    expect(screen.getByText('Phạm Dũng')).toBeInTheDocument();
  });

  it('celebrates a period with no rejected bugs', async () => {
    get.mockResolvedValue({ data: { ...result, rejected: { total: 0, items: [] } } });
    renderPage();
    expect(await screen.findByText(/Không có bug bị từ chối.*giữ phong độ/)).toBeInTheDocument();
  });

  it('shows an empty state without inventing a champion', async () => {
    get.mockResolvedValue({ data: { ...result, total: 0, items: [] } });
    renderPage();
    expect(await screen.findByText('Chưa có bug hợp lệ trong kỳ này')).toBeInTheDocument();
    expect(screen.queryByText('Đồng hạng nhất')).not.toBeInTheDocument();
  });

  it('shows a recoverable error instead of a winner when the request fails', async () => {
    get.mockRejectedValue(new Error('Network failure'));
    renderPage();
    await waitFor(() => expect(screen.getByText('Thử lại')).toBeInTheDocument());
    expect(screen.queryByText('Nguyễn An')).not.toBeInTheDocument();
    get.mockResolvedValue({ data: result });
    fireEvent.click(screen.getByText('Thử lại'));
    expect(await screen.findByText('Bảng xếp hạng')).toBeInTheDocument();
  });
});
