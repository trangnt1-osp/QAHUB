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
  accounts: [{ username: 'qa@example.test', password: ' test-secret ', role: 'Tester', notes: 'VPN' }],
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

  it('shows clickable and copyable URLs inline', async () => {
    renderEnvironments();

    await screen.findByRole('combobox', { name: 'Chọn môi trường' });
    await screen.findByRole('link', { name: environment.appUrl });
    const dialog = document.body;
    expect(within(dialog).getByRole('link', { name: environment.appUrl })).toHaveAttribute('href', environment.appUrl);
    expect(within(dialog).getByRole('link', { name: environment.apiUrl })).toHaveAttribute('href', environment.apiUrl);
    expect(within(dialog).getByLabelText('Sao chép URL ứng dụng')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Sao chép URL API')).toBeInTheDocument();
    expect(within(dialog).queryByRole('textbox', { name: 'URL ứng dụng' })).not.toBeInTheDocument();
    expect(screen.queryByText('Loại môi trường')).not.toBeInTheDocument();
    expect(screen.queryByText('Người phụ trách')).not.toBeInTheDocument();
    expect(screen.getByText('qa@example.test')).toBeInTheDocument();
    expect(screen.getByLabelText('Mật khẩu tài khoản 1')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Sao chép tài khoản 1')).toBeInTheDocument();
  });

  it('selects staging before other environments', async () => {
    vi.mocked(http.get).mockResolvedValue({ data: [environment, { ...environment, id: 2, name: 'Staging', kind: 'staging', appUrl: 'https://staging.example.com' }] } as never);
    renderEnvironments();
    expect(await screen.findByRole('link', { name: 'https://staging.example.com' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: environment.appUrl })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Sửa môi trường')).toBeEnabled();
    expect(screen.getByLabelText('Thêm môi trường')).toBeEnabled();
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Chọn môi trường' }));
    fireEvent.click(await screen.findByText(environment.name));
    expect(await screen.findByRole('link', { name: environment.appUrl })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'https://staging.example.com' })).not.toBeInTheDocument();
  });

  it('defaults new environments to Staging', async () => {
    renderEnvironments();
    fireEvent.click(await screen.findByLabelText('Thêm môi trường'));
    const dialog = await screen.findByRole('dialog', { name: 'Thêm môi trường' });
    expect(await within(dialog).findByDisplayValue('Staging')).toBeInTheDocument();
    expect(within(dialog).queryByText('Loại môi trường')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Người phụ trách')).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByText('Thêm tài khoản'));
    expect(within(dialog).getByLabelText('Tài khoản 1')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Mật khẩu 1')).toHaveAttribute('type', 'password');
  });
});
