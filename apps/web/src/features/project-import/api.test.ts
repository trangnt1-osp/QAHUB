import { afterEach, expect, it, vi } from 'vitest';
import axios, { AxiosError, type AxiosAdapter } from 'axios';
import { errorMessage, http, setAccessToken } from '../../api/http';
import { commitProjectImport, downloadProjectImportTemplate, previewProjectImport } from './api';
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); setAccessToken(null); });
it('uploads multipart file through the shared HTTP client with project and scope', async () => {
  const post = vi.spyOn(http, 'post').mockResolvedValue({ data: { jobId: 'job1' } });
  const file = new File(['data'], 'test.xlsx');
  expect(await previewProjectImport('QA space', 'backlog', file)).toBe('job1');
  const [url, body, config] = post.mock.calls[0];
  expect(url).toBe('/api/v1/projects/QA%20space/imports/preview');
  expect((body as FormData).get('file')).toBe(file);
  expect(config).toEqual({ params: { scope: 'backlog' }, headers: { 'Content-Type': undefined } });
});
it('surfaces server upload diagnostics', async () => {
  vi.spyOn(http, 'post').mockRejectedValue({ response: { data: { message: 'Import permission revoked' } } });
  await expect(previewProjectImport('QA', 'structure', new File([], 'test.xlsx')).catch(errorMessage)).resolves.toBe('Import permission revoked');
});
it('refreshes an expired token and retries the same multipart upload', async () => {
  const previousAdapter = http.defaults.adapter;
  const file = new File(['data'], 'test.xlsx');
  setAccessToken('expired-token');
  const refresh = vi.spyOn(axios, 'post').mockResolvedValue({ data: { accessToken: 'fresh-token' } });
  let attempt = 0;
  const adapter: AxiosAdapter = async (config) => {
    expect(config.data).toBeInstanceOf(FormData);
    expect(config.data.get('file')).toBe(file);
    if (++attempt === 1) {
      expect(config.headers.get('Authorization')).toBe('Bearer expired-token');
      throw new AxiosError('Expired', 'ERR_BAD_REQUEST', config, undefined, { status: 401, statusText: 'Unauthorized', data: {}, headers: {}, config });
    }
    expect(config.headers.get('Authorization')).toBe('Bearer fresh-token');
    return { data: { jobId: 'recovered-job' }, status: 202, statusText: 'Accepted', headers: {}, config };
  };
  http.defaults.adapter = adapter;
  try {
    expect(await previewProjectImport('QA', 'structure', file)).toBe('recovered-job');
    expect(attempt).toBe(2);
    expect(refresh).toHaveBeenCalledWith('/api/v1/auth/refresh', null, { withCredentials: true });
  } finally { http.defaults.adapter = previousAdapter; }
});
it('commits only the server session identifier', async () => {
  const post = vi.spyOn(http, 'post').mockResolvedValue({ data: { jobId: 'job2' } });
  expect(await commitProjectImport('QA', 'session/one')).toBe('job2');
  expect(post).toHaveBeenCalledWith('/api/v1/projects/QA/imports/session%2Fone/commit');
});
it('downloads the selected template and releases the object URL', async () => {
  vi.useFakeTimers();
  try {
    const blob = new Blob(['xlsx']);
    vi.spyOn(http, 'get').mockResolvedValue({ data: blob });
    const create = vi.fn().mockReturnValue('blob:template'); const revoke = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await downloadProjectImportTemplate('QA', 'all');
    expect(create).toHaveBeenCalledWith(blob);
    await vi.runAllTimersAsync(); expect(revoke).toHaveBeenCalledWith('blob:template');
  } finally { vi.useRealTimers(); }
});
