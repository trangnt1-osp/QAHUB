import { App } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi, it, expect, beforeEach, afterEach } from 'vitest';
import ProjectStructurePage from './ProjectStructurePage';
import { getProjectStructure, saveStructure } from './api';
vi.mock('../auth/authStore', () => ({ useAuth: () => ({ hasPermission: () => true }) }));
vi.mock('./api', async (original) => ({ ...await original<typeof import('./api')>(), getProjectStructure: vi.fn(), saveStructure: vi.fn() }));

beforeEach(() => {
  const getStyle = window.getComputedStyle.bind(window);
  // jsdom has no pseudo-element scrollbar styles; form state does not depend on them.
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => getStyle(element));
});
afterEach(() => vi.restoreAllMocks());

it('hydrates each mounted editor, preserves code on name-only save, and resets canceled drafts', async () => {
  vi.mocked(getProjectStructure).mockResolvedValue({ modules: [], functions: [], epics: [{ id: 100, requirementId: 33, key: 'QA-100', code: 'E1', name: 'Epic original', moduleIds: [7], functionIds: [22], explicitModuleIds: [], explicitFunctionIds: [], version: 1 }] });
  vi.mocked(saveStructure).mockResolvedValue({ data: {} } as Awaited<ReturnType<typeof saveStructure>>);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/projects/QA/structure']}><App><Routes><Route path="/projects/:projectKey/structure" element={<ProjectStructurePage />} /></Routes></App></MemoryRouter></QueryClientProvider>);
  fireEvent.click(screen.getByRole('tab', { name: 'Epic' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Sửa Epic' }));
  let dialog = await screen.findByRole('dialog');
  await waitFor(() => expect(within(dialog).getByLabelText('Mã')).toHaveValue('E1'));
  fireEvent.change(within(dialog).getByLabelText('Tên'), { target: { value: 'Canceled draft' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Hủy' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Sửa Epic' }));
  dialog = await screen.findByRole('dialog');
  await waitFor(() => expect(within(dialog).getByLabelText('Tên')).toHaveValue('Epic original'));
  expect(within(dialog).getByLabelText('Mã')).toHaveValue('E1');
  fireEvent.change(within(dialog).getByLabelText('Tên'), { target: { value: 'Renamed' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }));
  await waitFor(() => expect(saveStructure).toHaveBeenCalledWith('QA', 'epic', { code: 'E1', name: 'Renamed', moduleIds: [], functionIds: [] }, 33));
}, 15_000);
