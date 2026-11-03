import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProjectImportButton } from './ProjectImportButton';
import * as api from './api';

vi.mock('./api', () => ({ previewProjectImport: vi.fn(), commitProjectImport: vi.fn(), importJobResult: vi.fn(), downloadProjectImportTemplate: vi.fn() }));
const counts = { modules: { create: 1, update: 0 }, epics: { create: 0, update: 0 }, functions: { create: 0, update: 0 }, backlog: { create: 0, update: 0 } };
const preview: api.ImportPreview = { sessionId: 'session-1', fileName: 'data.xlsx', scope: 'structure', canCommit: true, counts, errors: [], warnings: [], rows: [{ sheet: 'Modules', row: 2, entity: 'module', code: 'M1', action: 'create', summary: 'A module', errors: [] }] };
beforeEach(() => {
  vi.resetAllMocks();
  const getStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => getStyle(element));
});
afterEach(() => vi.restoreAllMocks());
function mount(canImport = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ProjectImportButton projectKey="QA" scope="structure" templateKind="module" canImport={canImport} /></QueryClientProvider>);
  return client;
}
async function upload() {
  fireEvent.click(screen.getByRole('button', { name: 'Import Excel' }));
  const input = document.querySelector('input[type="file"]')!;
  fireEvent.change(input, { target: { files: [new File(['xlsx'], 'data.xlsx')] } });
  await screen.findByText('data.xlsx');
}
it('does not render without explicit import permission', () => {
  mount(false);
  expect(screen.queryByRole('button', { name: 'Import Excel' })).not.toBeInTheDocument();
});
it('blocks commit when server diagnostics report errors even if canCommit is true', async () => {
  vi.mocked(api.previewProjectImport).mockResolvedValue('preview-job');
  vi.mocked(api.importJobResult).mockResolvedValue({ ...preview, errors: [{ sheet: 'Modules', row: 2, message: 'Duplicate code' }] });
  mount(); await upload();
  expect(screen.getByText(/Duplicate code/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Ghi dữ liệu' })).toBeDisabled();
  expect(api.commitProjectImport).not.toHaveBeenCalled();
});
it('honors server canCommit=false without attempting a commit', async () => {
  vi.mocked(api.previewProjectImport).mockResolvedValue('preview-job');
  vi.mocked(api.importJobResult).mockResolvedValue({ ...preview, canCommit: false });
  mount(); await upload();
  expect(screen.getByRole('button', { name: 'Ghi dữ liệu' })).toBeDisabled();
});
it('blocks commit for row errors even when the global diagnostic list is empty', async () => {
  vi.mocked(api.previewProjectImport).mockResolvedValue('preview-job');
  vi.mocked(api.importJobResult).mockResolvedValue({ ...preview, rows: [{ ...preview.rows[0], action: 'error', errors: ['Invalid module'] }] });
  mount(); await upload();
  expect(screen.getByText('Invalid module')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Ghi dữ liệu' })).toBeDisabled();
});
it('commits the reviewed session, shows allocated keys, and refreshes cached lists', async () => {
  vi.mocked(api.previewProjectImport).mockResolvedValue('preview-job');
  vi.mocked(api.commitProjectImport).mockResolvedValue('commit-job');
  vi.mocked(api.importJobResult).mockResolvedValueOnce(preview).mockResolvedValueOnce({ sessionId: preview.sessionId, counts, rows: [{ ...preview.rows[0], itemKey: 'QA-42' }], completedAt: '2026-11-03' });
  const client = mount(); const invalidate = vi.spyOn(client, 'invalidateQueries');
  await upload(); fireEvent.click(screen.getByRole('button', { name: 'Ghi dữ liệu' }));
  expect(await screen.findByText('QA-42')).toBeInTheDocument();
  expect(api.commitProjectImport).toHaveBeenCalledWith('QA', 'session-1');
  await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['backlog'] }));
});
