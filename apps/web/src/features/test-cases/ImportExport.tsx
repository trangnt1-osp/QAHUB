import { DownloadOutlined, UploadOutlined } from '@ant-design/icons';
import { Alert, App, Button, Descriptions, Modal, Spin, Tag, Upload } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { commitImport, exportTestCases } from '../../api/generated/api';
import { errorMessage, getAccessToken } from '../../api/http';
import { usePermission } from '../auth/authStore';
import { waitForJob } from './jobs';
import { fmtNumber } from '../../lib/number';

export function ExportButton({ projectKey, functionId, epicId, moduleId }: { projectKey: string; functionId?: string; epicId?: string; moduleId?: string }) {
  const canExport = usePermission(projectKey, 'testcase.export');
  const [busy, setBusy] = useState(false);
  const { message } = App.useApp();
  return (
    <Button disabled={!canExport} icon={<DownloadOutlined />} loading={busy} onClick={async () => {
      if (!canExport) return;
      setBusy(true);
      try {
        const { jobId } = await exportTestCases(projectKey, { functionId, epicId, moduleId } as any);
        const job = await waitForJob(jobId);
        if (job.downloadUrl) window.open(job.downloadUrl, '_blank');
        else message.warning('Không có link tải');
      } catch (e) { message.error(errorMessage(e)); } finally { setBusy(false); }
    }}>Export Excel</Button>
  );
}

/** Import Excel có bước xem trước trước khi ghi (mục 7). */
export function ImportButton({ projectKey }: { projectKey: string }) {
  const canImport = usePermission(projectKey, 'testcase.import');
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'pick' | 'loading' | 'preview' | 'done'>('pick');
  const [preview, setPreview] = useState<any>(null);
  const [previewJobId, setPreviewJobId] = useState<string>();
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string>();
  const qc = useQueryClient();
  const reset = () => { setStep('pick'); setPreview(null); setResult(null); setError(undefined); };

  const upload = async (file: File) => {
    if (!canImport) return;
    setStep('loading'); setError(undefined);
    try {
      const fd = new FormData(); fd.append('file', file);
      const res = await fetch(`/api/v1/projects/${projectKey}/test-cases/import`, { method: 'POST', body: fd, headers: { Authorization: `Bearer ${getAccessToken()}` }, credentials: 'include' });
      if (!res.ok) throw new Error((await res.json()).message ?? 'Upload thất bại');
      const { jobId } = await res.json();
      const job = await waitForJob(jobId);
      setPreview(job.result); setPreviewJobId(jobId); setStep('preview');
    } catch (e) { setError((e as Error).message); setStep('pick'); }
  };

  const commit = async () => {
    if (!canImport) return;
    setStep('loading');
    try {
      const { jobId } = await commitImport(projectKey, { previewJobId: previewJobId! });
      const job = await waitForJob(jobId);
      setResult(job.result); setStep('done');
      void qc.invalidateQueries();
    } catch (e) { setError(errorMessage(e)); setStep('preview'); }
  };

  return (
    <>
      <Button disabled={!canImport} icon={<UploadOutlined />} onClick={() => { reset(); setOpen(true); }}>Import Excel</Button>
      <Modal title="Import test case từ Excel" open={open && canImport} onCancel={() => setOpen(false)} width={640} destroyOnClose
        footer={step === 'preview' ? [<Button key="c" onClick={() => setOpen(false)}>Hủy</Button>, <Button key="ok" type="primary" onClick={commit}>Ghi dữ liệu</Button>] : step === 'done' ? [<Button key="x" type="primary" onClick={() => setOpen(false)}>Đóng</Button>] : null}>
        {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}
        {step === 'pick' && (
          <Upload.Dragger accept=".xlsx" maxCount={1} showUploadList={false} beforeUpload={(f) => { void upload(f); return false; }}>
            <p className="ant-upload-drag-icon"><UploadOutlined /></p>
            <p>Chọn hoặc kéo thả file .xlsx theo mẫu checklist (mỗi function một sheet)</p>
          </Upload.Dragger>
        )}
        {step === 'loading' && <div style={{ textAlign: 'center', padding: 32 }}><Spin /> <div className="muted">Đang xử lý…</div></div>}
        {step === 'preview' && preview && (
          <>
            <Descriptions column={2} size="small" bordered>
              <Descriptions.Item label="Sheet">{fmtNumber(preview.sheets.length)}</Descriptions.Item>
              <Descriptions.Item label="Epic mới">{fmtNumber(preview.epics.create)}</Descriptions.Item>
              <Descriptions.Item label="Function mới">{fmtNumber(preview.functions.create)}</Descriptions.Item>
              <Descriptions.Item label="Category mới">{fmtNumber(preview.newCategories.length)}</Descriptions.Item>
              <Descriptions.Item label="Test case tạo mới"><b>{fmtNumber(preview.testCases.create)}</b></Descriptions.Item>
              <Descriptions.Item label="Test case cập nhật"><b>{fmtNumber(preview.testCases.update)}</b></Descriptions.Item>
            </Descriptions>
            {preview.warnings.length > 0 && (
              <div style={{ maxHeight: 160, overflow: 'auto', marginTop: 12 }}>
                {preview.warnings.map((w: any, i: number) => <div key={i}><Tag color="orange">{w.sheet}{w.row ? `:${w.row}` : ''}</Tag>{w.message}</div>)}
              </div>
            )}
          </>
        )}
        {step === 'done' && result && <Alert type="success" showIcon message={`Đã tạo ${fmtNumber(result.created)}, cập nhật ${fmtNumber(result.updated)} test case; ${fmtNumber(result.functions)} function, ${fmtNumber(result.epics)} epic mới.`} />}
      </Modal>
    </>
  );
}
