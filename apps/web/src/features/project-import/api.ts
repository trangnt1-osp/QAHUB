import { http } from '../../api/http';
import { waitForJob } from '../test-cases/jobs';

export type ImportScope = 'structure' | 'backlog';
export type TemplateKind = 'module' | 'epic' | 'function' | 'all' | 'backlog';
export interface ImportMessage { sheet: string; row?: number; column?: string; message: string }
export interface ImportRow { sheet: string; row: number; entity: string; code: string; action: 'create' | 'update' | 'error'; summary?: string; errors?: string[]; itemKey?: string }
export type ImportCounts = Record<'modules' | 'epics' | 'functions' | 'backlog', { create: number; update: number }>;
export interface ImportPreview { sessionId: string; fileName: string; scope: ImportScope; canCommit: boolean; counts: ImportCounts; rows: ImportRow[]; errors: ImportMessage[]; warnings: ImportMessage[] }
export interface ImportResult { sessionId: string; counts: ImportCounts; rows: ImportRow[]; completedAt: string }
const base = (key: string) => `/api/v1/projects/${encodeURIComponent(key)}/imports`;

export async function previewProjectImport(key: string, scope: ImportScope, file: File): Promise<string> {
  const body = new FormData(); body.append('file', file);
  // Keep authentication refresh/retry in the shared client. The browser supplies
  // the multipart boundary for FormData; do not hard-code a content type.
  const { data } = await http.post<{ jobId: string }>(`${base(key)}/preview`, body, { params: { scope }, headers: { 'Content-Type': undefined } });
  return data.jobId;
}
export async function commitProjectImport(key: string, sessionId: string): Promise<string> {
  return (await http.post<{ jobId: string }>(`${base(key)}/${encodeURIComponent(sessionId)}/commit`)).data.jobId;
}
export async function importJobResult<T>(jobId: string): Promise<T> { return (await waitForJob(jobId)).result as T; }
export async function downloadProjectImportTemplate(key: string, kind: TemplateKind): Promise<void> {
  const { data } = await http.get<Blob>(`${base(key)}/template`, { params: { kind }, responseType: 'blob' });
  const url = URL.createObjectURL(data);
  const link = document.createElement('a'); link.href = url; link.download = `${key}-${kind}-import.xlsx`;
  document.body.append(link); link.click(); link.remove();
  // Let the browser start consuming the download before releasing its object URL.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
