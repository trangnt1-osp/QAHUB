import { LinkOutlined } from '@ant-design/icons';
import { Card, DatePicker, Input, Select, Space, Tag, Tooltip, Typography } from 'antd';
import { ListTable } from '../../components/ListTable';
import { useCursorPagination } from '../../lib/useCursorPagination';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { listAutomationRuns } from '../../api/generated/api';
import { QueryBoundary } from '../../components/EmptyState';
import { fmtDateTime } from '../../lib/date';
import { useAuth } from '../auth/authStore';

export const RUN_STATUS_COLOR: Record<string, string> = { receiving: 'default', processing: 'processing', completed: 'success', failed: 'error' };

export function RatioBar({ r }: { r: { total: number; passed: number; failed: number; flaky: number; skipped: number } }) {
  const t = Math.max(1, r.total);
  const seg = (n: number, c: string, label: string) => n > 0 && <Tooltip title={`${label}: ${n}`}><div style={{ width: `${(n / t) * 100}%`, background: c, height: 10 }} /></Tooltip>;
  return <div style={{ display: 'flex', width: 140, borderRadius: 3, overflow: 'hidden', background: '#f0f0f0' }}>{seg(r.passed, '#52c41a', 'passed')}{seg(r.flaky, '#faad14', 'flaky')}{seg(r.failed, '#f5222d', 'failed')}{seg(r.skipped, '#bfbfbf', 'skipped')}</div>;
}

export function ReportsPage() {
  const projects = useAuth((s) => s.projects);
  const [sp, setSp] = useSearchParams();
  const projectKey = sp.get('project') ?? projects[0]?.projectKey;
  const [branch, setBranch] = useState<string>();
  const [environment, setEnvironment] = useState<string>();
  const [range, setRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null);
  const nav = useNavigate();
  const filters = { branch, environment, from: range?.[0]?.startOf('day').toISOString(), to: range?.[1]?.endOf('day').toISOString() };
  const paging = useCursorPagination(JSON.stringify([projectKey, filters]));
  const params = { ...filters, limit: paging.pageSize, cursor: paging.cursor };
  const { data, isLoading, isFetching, error, refetch } = useQuery<any>({ queryKey: ['runs', projectKey, params], queryFn: () => listAutomationRuns(projectKey!, params as any), enabled: !!projectKey });
  const chartData = useQuery<any>({ queryKey: ['run-chart', projectKey, filters], queryFn: () => listAutomationRuns(projectKey!, { ...filters, limit: 20 } as any), enabled: !!projectKey });
  const chart = useMemo(() => (chartData.data?.items ?? []).slice(0, 20).reverse().map((r: any) => ({ name: `#${r.id}`, passRate: r.passRate ?? 0 })), [chartData.data]);
  return (
    <div className="page">
      <Typography.Title level={3} style={{ marginTop: 0 }}>Report</Typography.Title>
      <Space wrap style={{ marginBottom: 12 }}>
        <Select style={{ width: 240 }} value={projectKey} onChange={(v) => setSp({ project: v })} options={projects.map((p) => ({ value: p.projectKey, label: `${p.projectKey} — ${p.projectName}` }))} placeholder="Chọn dự án" />
        <Input allowClear placeholder="Branch" style={{ width: 150 }} onChange={(e) => setBranch(e.target.value || undefined)} />
        <Input allowClear placeholder="Môi trường" style={{ width: 150 }} onChange={(e) => setEnvironment(e.target.value || undefined)} />
        <DatePicker.RangePicker format="DD/MM/YYYY" onChange={(v) => setRange(v as any)} />
      </Space>
      <QueryBoundary isLoading={isLoading} error={error} refetch={refetch}>
        {data && (
          <>
            <Card size="small" title="Tỉ lệ pass — 20 lần chạy gần nhất" style={{ marginBottom: 12 }}>
              <div style={{ height: 160 }}>
                <ResponsiveContainer>
                  <BarChart data={chart}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" fontSize={12} /><YAxis domain={[0, 100]} fontSize={12} unit="%" /><RTooltip formatter={(v) => `${v}%`} /><Bar dataKey="passRate" fill="#52c41a" isAnimationActive={false} /></BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <ListTable rowKey="id" size="middle" dataSource={data.items} style={{ background: '#fff' }}
              locale={{ emptyText: 'Chưa có lần chạy nào được gửi lên' }}
              cursorPage={{ current: paging.current, pageSize: paging.pageSize, hasNext: !!data.nextCursor, pending: isFetching,
                onPrevious: paging.previous, onNext: () => paging.next(data.nextCursor), onPageSizeChange: paging.setPageSize }}
              onRow={(r: any) => ({ onClick: () => nav(`/reports/runs/${r.id}`), style: { cursor: 'pointer' } })}
              columns={[
                { title: 'Thời gian', dataIndex: 'createdAt', width: 150, render: fmtDateTime },
                { title: 'Tên', dataIndex: 'name', render: (n, r: any) => n ?? `Run #${r.id}` },
                { title: 'Môi trường', dataIndex: 'environment', width: 110 },
                { title: 'Branch @ commit', render: (_, r: any) => <span>{r.branch ?? '—'}{r.commitSha && <span className="muted"> @ {r.commitSha}</span>}</span> },
                { title: 'Xử lý', dataIndex: 'status', width: 110, render: (s) => <Tag color={RUN_STATUS_COLOR[s]}>{s}</Tag> },
                { title: 'passed / failed / flaky / skipped', width: 230, render: (_, r: any) => <Space><RatioBar r={r} /><span className="muted">{r.passed}/{r.failed}/{r.flaky}/{r.skipped}</span></Space> },
                { title: 'Bug mới / cập nhật', width: 130, render: (_, r: any) => <span>{r.bugsCreated} / {r.bugsUpdated}</span> },
                { title: 'Thời lượng', dataIndex: 'durationMs', width: 100, render: (d) => (d ? `${Math.round(Number(d) / 1000)}s` : '—') },
                { title: 'CI', dataIndex: 'ciUrl', width: 50, render: (u) => u && <a href={u} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}><LinkOutlined /></a> },
              ]} />
          </>
        )}
      </QueryBoundary>
    </div>
  );
}
