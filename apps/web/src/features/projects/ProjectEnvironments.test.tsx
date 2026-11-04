import { App } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { vi } from 'vitest';
import { http } from '../../api/http';
import { useAuth } from '../auth/authStore';
import { ProjectEnvironments } from './ProjectEnvironments';

const environment = {
  id: 1,
  name: 'UAT khách hàng',
  kind: 'uat',
  appUrl: 'https://uat.example.com',
  apiUrl: 'https://api-uat.example.com',
  deployedVersion: 'v1.2.0',
  ownerId: null,
  owner: null,
  status: 'active',
  notes: 'Cần kết nối VPN',
  version: 1,
};

function renderEnvironments() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <App>
      <QueryClientProvider client={queryClient}>
        <ProjectEnvironments projectKey="DEMO" />
      </QueryClientProvider>
    </App>,
  );
}

describe('ProjectEnvironments', () => {
  beforeEach(() => {
    const getComputedStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => getComputedStyle(element));
    useAuth.setState({
      user: { id: 1, email: 'admin@local.test', displayName: 'Admin', avatarUrl: null, systemRole: 'admin' },
      projects: [],
      ready: true,
    });
    vi.spyOn(http, 'get').mockImplementation(async (url) => ({
      data: String(url).endsWith('/owners') ? [] : [environment],
    }) as never);
  });

  afterEach(() => vi.restoreAllMocks());

  it('shows clickable and copyable URLs in view mode instead of disabled edit fields', async () => {
    renderEnvironments();

    fireEvent.click(await screen.findByText(environment.name));

    const dialog = await screen.findByRole('dialog', { name: 'Thông tin môi trường' });
    expect(within(dialog).getByRole('link', { name: environment.appUrl })).toHaveAttribute('href', environment.appUrl);
    expect(within(dialog).getByRole('link', { name: environment.apiUrl })).toHaveAttribute('href', environment.apiUrl);
    expect(within(dialog).getByLabelText('Sao chép URL ứng dụng')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Sao chép URL API')).toBeInTheDocument();
    expect(within(dialog).queryByRole('textbox', { name: 'URL ứng dụng' })).not.toBeInTheDocument();
  });
});
