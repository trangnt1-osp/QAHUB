import { fmtNumber } from '../../lib/number';
import { Alert, Button, Card, Descriptions, Drawer, Input, Select, Space, Statistic, Tag, Typography, App } from 'antd';
import { ListTable } from '../../components/ListTable';
import { useCursorPagination } from '../../lib/useCursorPagination';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { createIssueFromResult, getAutomationResult, getAutomationRun, listAutomationResults } from '../../api/generated/api';
import { errorMessage } from '../../api/http';
import { AttachmentList } from '../../components/AttachmentList';
import { QueryBoundary } from '../../components/EmptyState';
import { fmtDateTime } from '../../lib/date';
import { usePermission } from '../auth/authStore';
import { RatioBar, RUN_STATUS_COLOR } from './ReportsPage';

const RESULT_COLOR: Record<string, string> = { passed: 'success', failed: 'error', timedOut: 'error', interrupted: 'error', skipped: 'default', flaky: 'warning' };

export function RunDetailPage() {
  const { runId = '' } = useParams();
  const [status, setStatus] = useState<string>();
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const run = useQuery<any>({ queryKey: ['run', runId], queryFn: () => getAutomationRun(runId), refetchInterval: (query) => (['receiving', 'processing'].includes((query.state.data as any)?.status) ? 3000 : false) });
  const paging = useCursorPagination(JSON.stringify([runId, status, q]));
  const results = useQuery<any>({ queryKey: ['run-results', runId, status, q, paging.cursor, paging.pageSize], queryFn: () => listAutomationResults(runId, { status, q: q || undefined, limit: paging.pageSize, cursor: paging.cursor } as any) });
  const r = run.data;
  return (
    <div className="page">
      <Link to={r ? `/reports?project=${r.projectKey}` : '/reports'}>← Report</Link>
      <QueryBoundary isLoading={run.isLoading} error={run.error} refetch={run.refetch}>
        {r && (
          <>
            <Space wrap style={{ margin: '8px 0 16px' }}><Typography.Text strong>Run #{r.id} {r.name && `— ${r.name}`}</Typography.Text><Tag color={RUN_STATUS_COLOR[r.status]}>{r.status}</Tag></Space>
            {r.processingError && <Alert type="error" showIcon message={`Xử lý lỗi: ${r.processingError}`} style={{ marginBottom: 12 }} />}
            <Space size={16} wrap style={{ marginBottom: 16 }}>
              {[['Tổng', r.total], ['Passed', r.passed], ['Failed', r.failed], ['Flaky', r.flaky], ['Skipped', r.skipped], ['Bug mới', r.bugsCreated], ['Bug cập nhật', r.bugsUpdated]].map(([t, v]) => (
                <Card key={t as string} size="small" style={{ minWidth: 100 }}><Statistic groupSeparator="." decimalSeparator="," title={t as string} value={v as number} /></Card>
              ))}
              <RatioBar r={r} />
            </Space>
            <Descriptions size="small" column={4} style={{ marginBottom: 12 }}>
              <Descriptions.Item label="Môi trường">{r.environment ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="Branch">{r.branch ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="Commit">{r.commitSha ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="CI">{r.ciUrl ? <a href={r.ciUrl} target="_blank" rel="noreferrer">Mở pipeline</a> : '—'}</Descriptions.Item>
              <Descriptions.Item label="Bắt đầu">{fmtDateTime(r.startedAt)}</Descriptions.Item>
              <Descriptions.Item label="Kết thúc">{fmtDateTime(r.finishedAt)}</Descriptions.Item>
            </Descriptions>
          </>
        )}
      </QueryBoundary>
      <Space style={{ marginBottom: 8 }}>
        <Select allowClear placeholder="Lọc trạng thái" style={{ width: 160 }} value={status} onChange={setStatus} options={['passed', 'failed', 'timedOut', 'interrupted', 'skipped', 'flaky'].map((s) => ({ value: s, label: s }))} />
        <Input.Search allowClear placeholder="Tìm file, tên test, lỗi" style={{ width: 280 }} onSearch={setQ} />
      </Space>
      <QueryBoundary isLoading={results.isLoading} error={results.error} refetch={results.refetch}>
        <ListTable rowKey="id" size="small" dataSource={results.data?.items} style={{ background: '#fff' }}
          locale={{ emptyText: 'Không có kết quả' }}
          cursorPage={{ current: paging.current, pageSize: paging.pageSize, hasNext: !!results.data?.nextCursor, pending: results.isFetching,
            onPrevious: paging.previous, onNext: () => paging.next(results.data?.nextCursor), onPageSizeChange: paging.setPageSize }}
          onRow={(rec: any) => ({ onClick: () => setOpenId(rec.id), style: { cursor: 'pointer' } })}
          columns={[
            { title: 'Test', dataIndex: 'titlePath', ellipsis: true, render: (t: string[]) => t.join(' › ') },
            { title: 'File', width: 260, ellipsis: true, render: (_, rec: any) => `${rec.file}${rec.line ? `:${rec.line}` : ''}` },
            { title: 'Browser', dataIndex: 'browser', width: 90 },
            { title: 'Trạng thái', dataIndex: 'status', width: 110, render: (s) => <Tag color={RESULT_COLOR[s]}>{s}</Tag> },
            { title: 'Thời lượng', dataIndex: 'durationMs', width: 90, render: (d) => (d != null ? `${fmtNumber(d / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}s` : '—') },
            { title: 'Retry', dataIndex: 'retries', width: 60 },
            { title: 'Bug', width: 200, render: (_, rec: any) => rec.issue ? <Space><Link to={`/browse/${rec.issue.key}`} onClick={(e) => e.stopPropagation()}>{rec.issue.key}</Link><Tag color={rec.issueAction === 'created' ? 'purple' : 'blue'}>{rec.issueAction}</Tag></Space> : rec.issueAction === 'skipped_flaky' ? <Tag>skipped flaky</Tag> : null },
          ]} />
      </QueryBoundary>
      <ResultDrawer id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

function ResultDrawer({ id, onClose }: { id: number | null; onClose: () => void }) {
  const { data, refetch } = useQuery<any>({ queryKey: ['run-result', id], queryFn: () => getAutomationResult(String(id)), enabled: !!id });
  const canCreate = usePermission(data?.projectKey, 'report.issue.create');
  const canViewAttachments = usePermission(data?.projectKey, 'attachment.view');
  const qc = useQueryClient();
  const { message } = App.useApp();
  return (
    <Drawer open={!!id} onClose={onClose} width="min(900px, 94vw)" destroyOnClose title={data ? data.titlePath.join(' › ') : 'Kết quả'}>
      {data && (
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Descriptions size="small" column={2}>
            <Descriptions.Item label="File">{data.file}{data.line ? `:${data.line}` : ''}</Descriptions.Item>
            <Descriptions.Item label="Browser">{data.browser ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Trạng thái"><Tag color={RESULT_COLOR[data.status]}>{data.status}</Tag> retry {fmtNumber(data.retries)}</Descriptions.Item>
            <Descriptions.Item label="Tag">{data.tags.map((t: string) => <Tag key={t}>{t}</Tag>)}</Descriptions.Item>
          </Descriptions>
          {data.errorMessage && <div><b>Lỗi</b><pre style={{ background: '#fff2f0', padding: 8, whiteSpace: 'pre-wrap' }}>{data.errorMessage}</pre></div>}
          {data.errorSnippet && <div><b>Đoạn code lỗi</b><pre style={{ background: '#f6f8fa', padding: 8, overflow: 'auto' }}>{data.errorSnippet}</pre></div>}
          {data.errorStack && <details><summary>Stack trace</summary><pre style={{ background: '#f6f8fa', padding: 8, overflow: 'auto' }}>{data.errorStack}</pre></details>}
          <div><b>Đính kèm</b>{canViewAttachments && <AttachmentList items={data.attachments} readOnly />}</div>
          {data.issue ? <div>Bug liên quan: <Link to={`/browse/${data.issue.key}`}>{data.issue.key}</Link> {data.issue.title}</div> : canCreate && ['failed', 'timedOut', 'interrupted', 'flaky'].includes(data.status) && (
            <Button type="primary" danger onClick={async () => { if (!canCreate) return; try { const r = await createIssueFromResult(String(id)); message.success(`Đã tạo ${r.key}`); await refetch(); void qc.invalidateQueries(); } catch (e) { message.error(errorMessage(e)); } }}>Tạo bug thủ công</Button>
          )}
        </Space>
      )}
    </Drawer>
  );
}
