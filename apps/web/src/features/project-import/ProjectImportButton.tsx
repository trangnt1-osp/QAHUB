import { DownloadOutlined, UploadOutlined } from '@ant-design/icons';
import { Alert, Button, Descriptions, Modal, Select, Space, Spin, Steps, Tag, Upload } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '../../api/http';
import { ListTable } from '../../components/ListTable';
import { fmtNumber } from '../../lib/number';
import { commitProjectImport, downloadProjectImportTemplate, importJobResult, previewProjectImport, type ImportCounts, type ImportMessage, type ImportPreview, type ImportResult, type ImportRow, type ImportScope, type TemplateKind } from './api';

export interface ProjectImportButtonProps { projectKey: string; scope: ImportScope; templateKind: TemplateKind; canImport: boolean; label?: string }
const entityLabels = { modules: 'Module', epics: 'Epic', functions: 'Function', backlog: 'Backlog' };
function Counts({ counts }: { counts: ImportCounts }) {
  return <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }}>{(Object.keys(entityLabels) as (keyof ImportCounts)[]).map((key) => <Descriptions.Item key={key} label={entityLabels[key]}>{fmtNumber(counts[key].create)} tạo mới · {fmtNumber(counts[key].update)} cập nhật</Descriptions.Item>)}</Descriptions>;
}
function Messages({ items, type }: { items: ImportMessage[]; type: 'error' | 'warning' }) {
  return items.length ? <Alert type={type} showIcon message={`${type === 'error' ? 'Lỗi' : 'Cảnh báo'} (${fmtNumber(items.length)})`} description={<ul style={{ margin: 0, paddingLeft: 20 }}>{items.map((item, i) => <li key={i}>{[item.sheet, item.row !== undefined ? `dòng ${fmtNumber(item.row)}` : '', item.column].filter(Boolean).join(' · ')}: {item.message}</li>)}</ul>} /> : null;
}
export function ProjectImportButton({ projectKey, scope, templateKind, canImport, label = 'Import Excel' }: ProjectImportButtonProps) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState(templateKind);
  const [preview, setPreview] = useState<ImportPreview>();
  const [result, setResult] = useState<ImportResult>();
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string>();
  const [file, setFile] = useState<File>();
  const [pending, setPending] = useState<{ stage: 'preview' | 'commit'; jobId: string }>();
  const reset = () => { setPreview(undefined); setResult(undefined); setError(undefined); setFile(undefined); setPending(undefined); };
  const upload = async (selected: File) => {
    if (!canImport || busy) return;
    if (!/\.xlsx$/i.test(selected.name) || selected.size > 10 * 1024 * 1024) { setError('Chọn file .xlsx không quá 10 MB.'); return; }
    setBusy(true); setError(undefined); setFile(selected);
    try {
      const jobId = pending?.stage === 'preview' && selected === file ? pending.jobId : await previewProjectImport(projectKey, scope, selected);
      setPending({ stage: 'preview', jobId });
      setPreview(await importJobResult<ImportPreview>(jobId)); setPending(undefined);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const commit = async () => {
    if (!canImport || busy || !preview?.canCommit || preview.errors.length || preview.rows.some((row) => row.action === 'error' || row.errors?.length)) return;
    setBusy(true); setError(undefined);
    try {
      const jobId = pending?.stage === 'commit' ? pending.jobId : await commitProjectImport(projectKey, preview.sessionId);
      setPending({ stage: 'commit', jobId });
      setResult(await importJobResult<ImportResult>(jobId)); setPending(undefined);
      await Promise.all(['project-structure', 'project-structure-management', 'project-structure-options', 'requirements', 'epics', 'backlog', 'board', 'issues', 'issue', 'tc-summary'].map((key) => qc.invalidateQueries({ queryKey: [key] })));
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  if (!canImport) return null;
  const blocked = !preview?.canCommit || !!preview.errors.length || preview.rows.some((row) => row.action === 'error' || !!row.errors?.length);
  const rows = result?.rows ?? preview?.rows ?? [];
  return <>
    <Button aria-label={label} icon={<UploadOutlined />} onClick={() => { reset(); setKind(templateKind); setOpen(true); }}>{label}</Button>
    <Modal maskClosable={false} title={`Import ${scope === 'structure' ? 'cấu trúc dự án' : 'Backlog'} từ Excel`} open={open} width={1000} style={{ maxWidth: 'calc(100vw - 24px)' }} styles={{ body: { maxHeight: '65vh', overflowY: 'auto' } }} closable={!busy} keyboard={!busy} onCancel={() => { if (!busy) setOpen(false); }} destroyOnClose
      footer={<Space wrap><Button disabled={busy} onClick={() => setOpen(false)}>Đóng</Button>{(preview || result || file) && <Button disabled={busy} onClick={reset}>Chọn file khác</Button>}{!preview && file && error && <Button disabled={busy} onClick={() => void upload(file)}>Thử lại</Button>}{preview && !result && <Button type="primary" loading={busy} disabled={blocked} onClick={() => void commit()}>Ghi dữ liệu</Button>}</Space>}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Steps size="small" current={result ? 2 : preview ? 1 : 0} items={[{ title: 'Chọn file' }, { title: 'Xem trước' }, { title: 'Kết quả' }]} />
        {error && <Alert type="error" showIcon message={error} description="Nếu bản xem trước đã hết hạn hoặc dữ liệu đã thay đổi, hãy chọn lại file để kiểm tra lại." />}
        {busy && <Spin tip="Đang xử lý…"><div style={{ minHeight: 48 }} /></Spin>}
        {!preview && <>
          <Space wrap>{scope === 'structure' && <Select aria-label="Loại mẫu import" value={kind} disabled={busy || downloading} onChange={setKind} options={[{ value: 'module', label: 'Module' }, { value: 'epic', label: 'Epic' }, { value: 'function', label: 'Function' }, { value: 'all', label: 'Toàn bộ cấu trúc' }]} style={{ minWidth: 180 }} />}<Button icon={<DownloadOutlined />} loading={downloading} disabled={busy} onClick={async () => { setDownloading(true); setError(undefined); try { await downloadProjectImportTemplate(projectKey, kind); } catch (e) { setError(errorMessage(e)); } finally { setDownloading(false); } }}>Tải mẫu Excel</Button></Space>
          <Upload.Dragger accept=".xlsx" maxCount={1} showUploadList={false} disabled={busy} beforeUpload={(selected) => { void upload(selected); return false; }}><p className="ant-upload-drag-icon"><UploadOutlined /></p><p>Chọn hoặc kéo thả file .xlsx (tối đa 10 MB)</p></Upload.Dragger>
        </>}
        {preview && <><div>{preview.fileName}</div><Counts counts={result?.counts ?? preview.counts} />{!result && <><Messages items={preview.errors} type="error" /><Messages items={preview.warnings} type="warning" />{blocked && <Alert type="error" message="Chưa thể ghi dữ liệu. Sửa các lỗi và tải lại file để xem trước." />}</>}</>}
        {result && <Alert type="success" showIcon message="Đã nhập dữ liệu thành công" />}
        {(preview || result) && <ListTable<ImportRow> resetKey={result ? 'result' : preview?.sessionId} size="small" rowKey={(row) => `${row.sheet}-${row.row}`} dataSource={rows} scroll={{ x: 780 }} columns={[
          { title: 'Sheet', dataIndex: 'sheet', width: 100 }, { title: 'Dòng Excel', dataIndex: 'row', width: 100 }, { title: 'Mã', dataIndex: 'code', width: 130 },
          { title: 'Thao tác', dataIndex: 'action', width: 120, render: (action: string) => <Tag color={action === 'error' ? 'error' : action === 'create' ? 'green' : 'blue'}>{action === 'create' ? 'Tạo mới' : action === 'update' ? 'Cập nhật' : 'Lỗi'}</Tag> },
          { title: result ? 'Item key' : 'Chi tiết', key: 'detail', render: (_: unknown, row: ImportRow) => result ? row.itemKey ?? '—' : <>{row.summary}{row.errors?.map((text, i) => <div key={i} style={{ color: 'var(--ant-color-error, #ff4d4f)' }}>{text}</div>)}</> },
        ]} />}
      </Space>
    </Modal>
  </>;
}
