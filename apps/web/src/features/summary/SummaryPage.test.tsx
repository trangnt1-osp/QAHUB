import { App } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { vi } from 'vitest';
import SummaryPage from './SummaryPage';
import { useUi } from '../../stores/ui';

const getSummary = vi.fn();

vi.mock('../../api/generated/api', async () => ({
  ...(await vi.importActual<typeof import('../../api/generated/api')>('../../api/generated/api')),
  getSummary: (...args: unknown[]) => getSummary(...args),
  getProjectActivity: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
}));

vi.mock('../../api/hooks', async () => ({
  ...(await vi.importActual<typeof import('../../api/hooks')>('../../api/hooks')),
  useMembers: () => ({ data: [] }),
  useProjectTracking: () => 'phase',
  useSprints: () => ({ data: [{ id: 41, name: 'Phase Alpha' }] }),
}));

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PieChart: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Pie: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Cell: () => null,
  Tooltip: () => null,
}));

const bugReport = {
  scope: 'open',
  createdLast7dFrom: '2026-10-27T12:00:00.000Z',
  cards: { total: 8, highest: 2, unassigned: 3, createdLast7d: 4 },
  statusOverview: { total: 8, items: [{ statusId: 11, name: 'To Do', category: 'todo', color: '#1677ff', count: 8 }] },
  byModule: [{ id: 21, label: 'PAY · Payments', count: 5 }],
  byEpic: [{ id: 31, label: 'DEMO-1 · Checkout', count: 4 }],
  byPeriod: [{ id: 41, label: 'Phase Alpha', count: 3 }],
  byFunction: [{ id: 51, label: 'PAY-LOGIN · Login', count: 2 }],
  byPriority: [{ priority: 'highest', count: 2 }, { priority: 'medium', count: 6 }],
};
const response = {
  cards: { completedLast7d: 1, updatedLast7d: 2, createdLast7d: 3, dueNext7d: 4 },
  statusOverview: { total: 10, items: [{ statusId: 11, name: 'To Do', category: 'todo', color: '#1677ff', count: 10 }] },
  bySource: { manual: 7, auto: 3, pendingReview: 1 },
  byType: [{ type: 'bug', count: 8 }, { type: 'task', count: 2 }],
  byPriority: [{ priority: 'highest', count: 3 }, { priority: 'medium', count: 7 }],
  bugReport,
  recentActivity: [], recentActivityNextCursor: null,
};

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="location">{location.pathname}{location.search}</output>;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<App><QueryClientProvider client={client}><MemoryRouter initialEntries={['/projects/DEMO/summary']}><Routes>
    <Route path="/projects/:projectKey/summary" element={<><SummaryPage /><LocationProbe /></>} />
    <Route path="/projects/:projectKey/backlog" element={<LocationProbe />} />
  </Routes></MemoryRouter></QueryClientProvider></App>);
}

describe('SummaryPage Report BUG', () => {
  beforeEach(() => getSummary.mockResolvedValue(response));
  afterEach(() => { vi.clearAllMocks(); useUi.getState().setAssigneeFilter('DEMO', []); });

  it('shows the open Bug dashboard and drills a Module into Backlog', async () => {
    renderPage();

    expect(await screen.findByText('Report BUG')).toBeInTheDocument();
    expect(screen.getByText('Status overview')).toBeInTheDocument();
    expect(screen.getByText('Manual và Auto')).toBeInTheDocument();
    expect(screen.getByText('Theo loại')).toBeInTheDocument();
    expect(screen.getByText('Bug đang mở')).toBeInTheDocument();
    expect(await screen.findByText('Tổng Bug đang mở')).toBeInTheDocument();
    expect(screen.getAllByText('Highest').length).toBeGreaterThan(0);
    expect(screen.getByText('Chưa phân công')).toBeInTheDocument();
    expect(screen.getByText('Mới trong 7 ngày')).toBeInTheDocument();
    for (const title of ['Theo trạng thái', 'Theo Module', 'Theo Epic', 'Theo Phase', 'Theo tính năng', 'Theo Priority']) expect(screen.getByText(title)).toBeInTheDocument();
    // Ant Design exposes both the select container and its input with the same accessible label.
    expect(screen.getAllByLabelText('Lọc Sprint/Phase')).toHaveLength(20);

    fireEvent.click(screen.getByText('PAY · Payments'));
    expect(await screen.findByLabelText('location')).toHaveTextContent('/projects/DEMO/backlog?type=bug&includeAllPeriods=true&statusCategory=open&moduleId=21');
  });

  it('switches to all Bugs and renders a clear empty state', async () => {
    getSummary.mockResolvedValueOnce(response).mockResolvedValueOnce({ ...response, bugReport: { ...bugReport, scope: 'all', cards: { total: 0, highest: 0, unassigned: 0, createdLast7d: 0 }, statusOverview: { total: 0, items: [] }, byModule: [], byEpic: [], byPeriod: [], byFunction: [], byPriority: [] } });
    renderPage();

    fireEvent.click(await screen.findByText('Tất cả Bug'));
    expect(await screen.findByText('Chưa có Bug trong phạm vi đã chọn')).toBeInTheDocument();
  });

  it('does not replace an active assignee filter from the unassigned KPI', async () => {
    useUi.getState().setAssigneeFilter('DEMO', [7]);
    renderPage();
    fireEvent.click(await screen.findByText('Chưa phân công'));
    expect(screen.getByLabelText('location')).toHaveTextContent('/projects/DEMO/summary');
  });
});
