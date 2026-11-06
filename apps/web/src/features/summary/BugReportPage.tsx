import { Button, Card, Col, Empty, Popover, Row, Segmented, Select, Space, Statistic, Typography } from 'antd';
import { FilterOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getSummary } from '../../api/generated/api';
import { useMembers, useProjectTracking, useSprints } from '../../api/hooks';
import { AvatarFilter } from '../../components/AvatarFilter';
import { QueryBoundary } from '../../components/EmptyState';
import { PriorityIcon } from '../../components/PriorityIcon';
import { fmtNumber } from '../../lib/number';
import { useUi } from '../../stores/ui';
import { BugBreakdown, type BugBreakdownRow } from './BugBreakdown';
import { StatusDonut } from './StatusDonut';
import type { SummaryData } from './SummaryPage';
import { BugRecognition } from './BugRecognition';
import BacklogPage from '../backlog/BacklogPage';
import { PermissionGate } from '../auth/PermissionGate';

const EMPTY: number[] = [];

type Scope = 'open' | 'all';
interface DimensionRow { id: number | null; label: string; count: number }
export interface BugReportData {
  scope: Scope;
  createdLast7dFrom: string;
  cards: { total: number; highest: number; unassigned: number; createdLast7d: number };
  statusOverview: { total: number; items: { statusId: number; name: string; category: string; color: string; count: number }[] };
  byModule: DimensionRow[]; byEpic: DimensionRow[]; byPeriod: DimensionRow[]; byFunction: DimensionRow[];
  byReporter: DimensionRow[];
  byPriority: { priority: string; count: number }[];
}
export function buildBugBacklogUrl(projectKey: string, scope: Scope, common: { assigneeIds?: number[]; source?: string }, extra: Record<string, string | number | undefined> = {}) {
  const query = new URLSearchParams();
  query.set('type', 'bug');
  query.set('includeAllPeriods', 'true');
  if (scope === 'open') query.set('statusCategory', 'open');
  if (common.assigneeIds?.length) query.set('assigneeIds', common.assigneeIds.join(','));
  if (common.source) query.set('source', common.source);
  for (const [key, value] of Object.entries(extra)) if (value !== undefined) query.set(key, String(value));
  return `/projects/${encodeURIComponent(projectKey)}/backlog?${query}`;
}

export default function BugReportPage() {
  const { projectKey = '' } = useParams();
  const [view, setView] = useState('list');
  return <div>
    <div className="page" style={{ paddingBottom: 0 }}><Segmented aria-label="Màn hình Bug" value={view} onChange={setView} options={[{ value: 'list', label: 'Danh sách Bug' }, { value: 'report', label: 'Báo cáo Bug' }, { value: 'recognition', label: 'Vinh danh' }]} /></div>
    {view === 'list' ? <PermissionGate permission="project.backlog.view"><BacklogPage fixedType="bug" /></PermissionGate> : view === 'recognition' ? <BugRecognition projectKey={projectKey} /> : <BugReportDashboard />}
  </div>;
}

function BugReportDashboard() {
  const { projectKey = '' } = useParams();
  const nav = useNavigate();
  const { data: members = [] } = useMembers(projectKey);
  const assignees = useUi((s) => s.assigneeFilter[projectKey] ?? EMPTY);
  const setAssignees = useUi((s) => s.setAssigneeFilter);
  const [source, setSource] = useState<string>();
  const [scope, setScope] = useState<Scope>('open');
  const trackingMode = useProjectTracking(projectKey);
  const { data: periods = [] } = useSprints(projectKey);
  const params = { assigneeIds: assignees.join(',') || undefined, type: 'bug', source, scope };
  const { data, isLoading, error, refetch } = useQuery<SummaryData>({ queryKey: ['summary', projectKey, params], queryFn: () => getSummary(projectKey, { params }) });
  const common = { assigneeIds: assignees, source };
  const goBacklog = (extra: Record<string, string | number | undefined> = {}) => nav(buildBugBacklogUrl(projectKey, scope, common, extra));
  const dimensionRows = (rows: DimensionRow[]): BugBreakdownRow[] => rows.map((row) => ({ key: String(row.id ?? 'none'), label: row.label, count: row.count, value: row.id }));

  return (
    <div className="page">
      <Space style={{ marginBottom: 16 }} wrap>
        <AvatarFilter users={members.map((m) => m.user)} value={assignees} onChange={(ids) => setAssignees(projectKey, ids)} />
        <Popover trigger="click" placement="bottomLeft" title="Bộ lọc" content={<Space direction="vertical" style={{ width: 240 }}>
          <Select allowClear placeholder="Nguồn" style={{ width: '100%' }} value={source} onChange={setSource} options={[{ value: 'manual', label: 'Manual' }, { value: 'auto', label: 'Auto' }]} />
        </Space>}><Button icon={<FilterOutlined />}>Filter{source ? ` (${fmtNumber(source ? 1 : 0)})` : ''}</Button></Popover>
      </Space>
      <QueryBoundary isLoading={isLoading} error={error} refetch={refetch}>
        {data && <>
            <Space style={{ margin: '28px 0 16px', width: '100%', justifyContent: 'space-between' }} wrap><Typography.Title level={3} style={{ margin: 0 }}>Report BUG</Typography.Title><Segmented value={scope} onChange={(value) => setScope(value as Scope)} options={[{ value: 'open', label: 'Bug đang mở' }, { value: 'all', label: 'Tất cả Bug' }]} /></Space>
            <Row gutter={[16, 16]}>
              <BugMetricWidget title={scope === 'open' ? 'Tổng Bug đang mở' : 'Tổng Bug'} cardKey="total" projectKey={projectKey} params={params} base={data.bugReport} periods={periods} onOpen={(period) => goBacklog({ sprintId: period })} />
              <BugMetricWidget title="Highest" cardKey="highest" projectKey={projectKey} params={params} base={data.bugReport} periods={periods} onOpen={(period) => goBacklog({ priority: 'highest', sprintId: period })} />
              <BugMetricWidget title="Chưa phân công" cardKey="unassigned" projectKey={projectKey} params={params} base={data.bugReport} periods={periods} disabled={assignees.length > 0} onOpen={(period) => goBacklog({ assigneeIds: 'unassigned', sprintId: period })} />
              <BugMetricWidget title="Mới trong 7 ngày" cardKey="createdLast7d" projectKey={projectKey} params={params} base={data.bugReport} periods={periods} onOpen={(period, report) => goBacklog({ createdAfter: report.createdLast7dFrom, sprintId: period })} />
            </Row>
            {data.bugReport.cards.total === 0 && <Empty style={{ margin: '24px 0' }} description="Chưa có Bug trong phạm vi đã chọn" />}
            <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
              <BugStatusWidget projectKey={projectKey} params={params} base={data.bugReport} periods={periods} onOpen={(statusId, period) => goBacklog({ statusIds: statusId, sprintId: period })} />
              <BugDimensionWidget title="Theo người log" projectKey={projectKey} params={params} base={data.bugReport} periods={periods} rows={(report) => dimensionRows(report.byReporter ?? [])} onOpen={(value, period) => goBacklog({ reporterId: value ?? 'unassigned', sprintId: period })} note="Tính theo người tạo bug (Reporter), không phải người được giao xử lý." />
              <BugDimensionWidget title="Theo Priority" projectKey={projectKey} params={params} base={data.bugReport} periods={periods} rows={(report) => report.byPriority.map((row) => ({ key: row.priority, label: <PriorityIcon priority={row.priority} withLabel />, count: row.count, value: row.priority }))} onOpen={(value, period) => goBacklog({ priority: String(value), sprintId: period })} />
              <BugDimensionWidget title="Theo Module" projectKey={projectKey} params={params} base={data.bugReport} periods={periods} rows={(report) => dimensionRows(report.byModule)} onOpen={(value, period) => goBacklog({ moduleId: value ?? 'unassigned', sprintId: period })} note="Một Bug có thể xuất hiện ở nhiều Module." />
              <BugDimensionWidget title="Theo Epic" projectKey={projectKey} params={params} base={data.bugReport} periods={periods} rows={(report) => dimensionRows(report.byEpic)} onOpen={(value, period) => goBacklog({ epicId: value ?? 'unassigned', sprintId: period })} />
              <BugDimensionWidget title={`Theo ${trackingMode === 'phase' ? 'Phase' : 'Sprint'}`} projectKey={projectKey} params={params} base={data.bugReport} periods={periods} rows={(report) => dimensionRows(report.byPeriod)} onOpen={(value, period) => goBacklog({ sprintId: period ?? value ?? 'backlog' })} />
              <BugDimensionWidget title="Theo tính năng" projectKey={projectKey} params={params} base={data.bugReport} periods={periods} rows={(report) => dimensionRows(report.byFunction)} onOpen={(value, period) => goBacklog({ functionId: value ?? 'unassigned', sprintId: period })} note="Một Bug có thể xuất hiện ở nhiều tính năng." />
            </Row>
        </>}
      </QueryBoundary>
    </div>
  );
}

type PeriodOption = { id: number; name: string };
type SummaryParams = { assigneeIds?: string; type?: string; source?: string; scope: Scope };

function useWidgetReport(projectKey: string, params: SummaryParams, period: string | undefined, base: BugReportData) {
  const query = useQuery<SummaryData>({
    queryKey: ['summary', projectKey, 'bug-widget', params, period],
    queryFn: () => getSummary(projectKey, { params: { ...params, sprintId: period } }),
    enabled: period !== undefined,
  });
  return period === undefined ? base : query.data?.bugReport ?? base;
}

function PeriodFilter({ periods, value, onChange }: { periods: PeriodOption[]; value?: string; onChange: (value?: string) => void }) {
  return <Select aria-label="Lọc Sprint/Phase" allowClear placeholder="Tất cả Sprint/Phase" value={value} onChange={onChange} onClick={(event) => event.stopPropagation()} style={{ width: 170 }}
    options={[{ value: 'backlog', label: 'Chưa phân bổ' }, ...periods.map((period) => ({ value: String(period.id), label: period.name }))]} />;
}

function BugMetricWidget({ title, cardKey, projectKey, params, base, periods, disabled, onOpen }: {
  title: string; cardKey: keyof BugReportData['cards']; projectKey: string; params: SummaryParams; base: BugReportData; periods: PeriodOption[]; disabled?: boolean;
  onOpen: (period: string | undefined, report: BugReportData) => void;
}) {
  const [period, setPeriod] = useState<string>();
  const report = useWidgetReport(projectKey, params, period, base);
  return <Col xs={12} md={6}><Card hoverable={!disabled} onClick={disabled ? undefined : () => onOpen(period, report)} extra={<PeriodFilter periods={periods} value={period} onChange={setPeriod} />}>
    <Statistic groupSeparator="." decimalSeparator="," title={title} value={report.cards[cardKey]} />
  </Card></Col>;
}

function BugStatusWidget({ projectKey, params, base, periods, onOpen }: { projectKey: string; params: SummaryParams; base: BugReportData; periods: PeriodOption[]; onOpen: (statusId: number, period?: string) => void }) {
  const [period, setPeriod] = useState<string>();
  const report = useWidgetReport(projectKey, params, period, base);
  return <Col xs={24} lg={12}><Card title="Theo trạng thái" extra={<PeriodFilter periods={periods} value={period} onChange={setPeriod} />} style={{ height: '100%' }}>
    <StatusDonut data={report.statusOverview} onSlice={(id) => onOpen(id, period)} totalLabel="Bug" />
  </Card></Col>;
}

function BugDimensionWidget({ title, projectKey, params, base, periods, rows, onOpen, note }: {
  title: string; projectKey: string; params: SummaryParams; base: BugReportData; periods: PeriodOption[];
  rows: (report: BugReportData) => BugBreakdownRow[]; onOpen: (value: BugBreakdownRow['value'], period?: string) => void; note?: string;
}) {
  const [period, setPeriod] = useState<string>();
  const report = useWidgetReport(projectKey, params, period, base);
  return <Col xs={24} lg={12}><BugBreakdown title={title} rows={rows(report)} onSelect={(value) => onOpen(value, period)} note={note} extra={<PeriodFilter periods={periods} value={period} onChange={setPeriod} />} /></Col>;
}

