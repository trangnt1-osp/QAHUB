import { fmtNumber } from '../../lib/number';
import { FilterOutlined, FullscreenOutlined } from '@ant-design/icons';
import { Button, Card, Col, Empty, Modal, Popover, Row, Segmented, Select, Space, Statistic, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip as RTooltip } from 'recharts';
import { useNavigate, useParams } from 'react-router-dom';
import { ISSUE_TYPES } from '@ospm/shared';
import { getProjectActivity, getSummary } from '../../api/generated/api';
import { useMembers, useProjectTracking } from '../../api/hooks';
import type { ActivityItem } from '../../api/models';
import { AvatarFilter } from '../../components/AvatarFilter';
import { QueryBoundary } from '../../components/EmptyState';
import { ISSUE_TYPE_LABEL, IssueTypeIcon } from '../../components/IssueTypeIcon';
import { PriorityIcon } from '../../components/PriorityIcon';
import { UserAvatar } from '../../components/UserAvatar';
import { dayLabel, fmtDateTime } from '../../lib/date';
import { useUi } from '../../stores/ui';
import { useSelectedIssue } from '../issues/useSelectedIssue';
import { BugBreakdown, type BugBreakdownRow } from './BugBreakdown';

const EMPTY: number[] = [];

type Scope = 'open' | 'all';
interface DimensionRow { id: number | null; label: string; count: number }
interface BugReportData {
  scope: Scope;
  createdLast7dFrom: string;
  cards: { total: number; highest: number; unassigned: number; createdLast7d: number };
  statusOverview: { total: number; items: { statusId: number; name: string; category: string; color: string; count: number }[] };
  byModule: DimensionRow[]; byEpic: DimensionRow[]; byPeriod: DimensionRow[]; byFunction: DimensionRow[];
  byPriority: { priority: string; count: number }[];
}
interface SummaryData {
  cards: { completedLast7d: number; updatedLast7d: number; createdLast7d: number; dueNext7d: number };
  statusOverview: { total: number; items: { statusId: number; name: string; category: string; color: string; count: number }[] };
  bySource: { manual: number; auto: number; pendingReview: number };
  byType: { type: string; count: number }[];
  byPriority: { priority: string; count: number }[];
  bugReport: BugReportData;
  recentActivity: ActivityItem[]; recentActivityNextCursor: string | null;
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

export default function SummaryPage() {
  const { projectKey = '' } = useParams();
  const nav = useNavigate();
  const { data: members = [] } = useMembers(projectKey);
  const assignees = useUi((s) => s.assigneeFilter[projectKey] ?? EMPTY);
  const setAssignees = useUi((s) => s.setAssigneeFilter);
  const [types, setTypes] = useState<string[]>([]);
  const [source, setSource] = useState<string>();
  const [scope, setScope] = useState<Scope>('open');
  const trackingMode = useProjectTracking(projectKey);
  const params = { assigneeIds: assignees.join(',') || undefined, type: types.join(',') || undefined, source, scope };
  const { data, isLoading, error, refetch } = useQuery<SummaryData>({ queryKey: ['summary', projectKey, params], queryFn: () => getSummary(projectKey, { params }) });
  const common = { assigneeIds: assignees, source };
  const goBacklog = (extra: Record<string, string | number | undefined> = {}) => nav(buildBugBacklogUrl(projectKey, scope, common, extra));
  const dimensionRows = (rows: DimensionRow[]): BugBreakdownRow[] => rows.map((row) => ({ key: String(row.id ?? 'none'), label: row.label, count: row.count, value: row.id }));
  const triageIds = (data?.statusOverview.items ?? []).filter((status) => status.category === 'triage').map((status) => status.statusId).join(',');

  return (
    <div className="page">
      <Space style={{ marginBottom: 16 }} wrap>
        <AvatarFilter users={members.map((m) => m.user)} value={assignees} onChange={(ids) => setAssignees(projectKey, ids)} />
        <Popover trigger="click" placement="bottomLeft" title="Bộ lọc" content={<Space direction="vertical" style={{ width: 240 }}>
          <Select mode="multiple" placeholder="Loại item" style={{ width: '100%' }} value={types} onChange={setTypes} options={ISSUE_TYPES.map((type) => ({ value: type, label: ISSUE_TYPE_LABEL[type] }))} />
          <Select allowClear placeholder="Nguồn" style={{ width: '100%' }} value={source} onChange={setSource} options={[{ value: 'manual', label: 'Manual' }, { value: 'auto', label: 'Auto' }]} />
        </Space>}><Button icon={<FilterOutlined />}>Filter{types.length || source ? ` (${fmtNumber(types.length + (source ? 1 : 0))})` : ''}</Button></Popover>
      </Space>
      <QueryBoundary isLoading={isLoading} error={error} refetch={refetch}>
        {data && (
          <>
            <Row gutter={[16, 16]}>
              {[
                { v: data.cards.completedLast7d, t: 'completed', s: 'in the last 7 days' },
                { v: data.cards.updatedLast7d, t: 'updated', s: 'in the last 7 days' },
                { v: data.cards.createdLast7d, t: 'created', s: 'in the last 7 days' },
                { v: data.cards.dueNext7d, t: 'due soon', s: 'in the next 7 days' },
              ].map((card) => <Col key={card.t} xs={12} md={6}><Card><Statistic groupSeparator="." decimalSeparator="," title={<span>{card.t}<br /><span className="muted">{card.s}</span></span>} value={card.v} /></Card></Col>)}
            </Row>
            <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
              <Col xs={24} lg={14}><Card title="Status overview" style={{ height: '100%' }}><StatusDonut data={data.statusOverview} onSlice={(id) => nav(`/projects/${projectKey}/backlog?statusIds=${id}`)} totalLabel="Total work items" /></Card></Col>
              <Col xs={24} lg={10}>
                <Card title="Manual và Auto" style={{ marginBottom: 16 }}><Space size={32} wrap><Statistic title="Manual" value={data.bySource.manual} /><Statistic title="Auto" value={data.bySource.auto} valueStyle={{ color: '#722ed1' }} /><Statistic title="Chờ duyệt" value={data.bySource.pendingReview} /></Space>{data.bySource.pendingReview > 0 && triageIds && <div style={{ marginTop: 8 }}><Button type="primary" ghost onClick={() => nav(`/projects/${projectKey}/backlog?statusIds=${triageIds}`)}>Duyệt ngay</Button></div>}</Card>
                <Card title="Theo loại" size="small" style={{ marginBottom: 16 }}><Bars rows={data.byType.map((row) => ({ label: <Space><IssueTypeIcon type={row.type as any} />{ISSUE_TYPE_LABEL[row.type as keyof typeof ISSUE_TYPE_LABEL]}</Space>, count: row.count }))} /></Card>
                <Card title="Theo priority" size="small"><Bars rows={data.byPriority.map((row) => ({ label: <PriorityIcon priority={row.priority} withLabel />, count: row.count }))} /></Card>
              </Col>
            </Row>
            <Space style={{ margin: '28px 0 16px', width: '100%', justifyContent: 'space-between' }} wrap><Typography.Title level={3} style={{ margin: 0 }}>Report BUG</Typography.Title><Segmented value={scope} onChange={(value) => setScope(value as Scope)} options={[{ value: 'open', label: 'Bug đang mở' }, { value: 'all', label: 'Tất cả Bug' }]} /></Space>
            <Row gutter={[16, 16]}>
              {[
                { v: data.bugReport.cards.total, t: scope === 'open' ? 'Tổng Bug đang mở' : 'Tổng Bug', extra: {} },
                { v: data.bugReport.cards.highest, t: 'Highest', extra: { priority: 'highest' } },
                { v: data.bugReport.cards.unassigned, t: 'Chưa phân công', extra: { assigneeIds: 'unassigned' }, disabled: assignees.length > 0 },
                { v: data.bugReport.cards.createdLast7d, t: 'Mới trong 7 ngày', extra: { createdAfter: data.bugReport.createdLast7dFrom }, disabled: false },
              ].map((card) => (
                <Col key={card.t} xs={12} md={6}><Card hoverable={!card.disabled} onClick={card.disabled ? undefined : () => goBacklog(card.extra)}><Statistic groupSeparator="." decimalSeparator="," title={card.t} value={card.v} /></Card></Col>
              ))}
            </Row>
            {data.bugReport.cards.total === 0 && <Empty style={{ margin: '24px 0' }} description="Chưa có Bug trong phạm vi đã chọn" />}
            <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
              <Col xs={24} lg={12}>
                <Card title="Theo trạng thái" style={{ height: '100%' }}>
                  <StatusDonut data={data.bugReport.statusOverview} onSlice={(id) => goBacklog({ statusIds: id })} totalLabel="Bug" />
                </Card>
              </Col>
              <Col xs={24} lg={12}><BugBreakdown title="Theo Priority" rows={data.bugReport.byPriority.map((row) => ({ key: row.priority, label: <PriorityIcon priority={row.priority} withLabel />, count: row.count, value: row.priority }))} onSelect={(value) => goBacklog({ priority: String(value) })} /></Col>
              <Col xs={24} lg={12}><BugBreakdown title="Theo Module" rows={dimensionRows(data.bugReport.byModule)} onSelect={(value) => goBacklog({ moduleId: value ?? 'unassigned' })} note="Một Bug có thể xuất hiện ở nhiều Module." /></Col>
              <Col xs={24} lg={12}><BugBreakdown title="Theo Epic" rows={dimensionRows(data.bugReport.byEpic)} onSelect={(value) => goBacklog({ epicId: value ?? 'unassigned' })} /></Col>
              <Col xs={24} lg={12}><BugBreakdown title={`Theo ${trackingMode === 'phase' ? 'Phase' : 'Sprint'}`} rows={dimensionRows(data.bugReport.byPeriod)} onSelect={(value) => goBacklog({ sprintId: value ?? 'backlog' })} /></Col>
              <Col xs={24} lg={12}><BugBreakdown title="Theo tính năng" rows={dimensionRows(data.bugReport.byFunction)} onSelect={(value) => goBacklog({ functionId: value ?? 'unassigned' })} note="Một Bug có thể xuất hiện ở nhiều tính năng." /></Col>
            </Row>
            <Card title="Recent activity" style={{ marginTop: 16 }} extra={<ActivityExpand projectKey={projectKey} />}>
              <ActivityFeed projectKey={projectKey} initial={data.recentActivity} initialCursor={data.recentActivityNextCursor} maxHeight={420} />
            </Card>
          </>
        )}
      </QueryBoundary>
    </div>
  );
}

function StatusDonut({ data, onSlice, totalLabel }: { data: { total: number; items: { statusId: number; name: string; color: string; count: number }[] }; onSlice: (statusId: number) => void; totalLabel: string }) {
  const items = data.items.filter((i) => i.count > 0);
  return (
    <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ position: 'relative', width: 240, height: 240 }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie data={items} dataKey="count" nameKey="name" innerRadius={72} outerRadius={110} paddingAngle={1} onClick={(d: any) => onSlice(d.statusId)} cursor="pointer" isAnimationActive={false}>
              {items.map((i) => <Cell key={i.statusId} fill={i.color} />)}
            </Pie>
            <RTooltip formatter={(value) => typeof value === 'number' ? fmtNumber(value) : value} />
          </PieChart>
        </ResponsiveContainer>
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none', textAlign: 'center' }}>
          <div><div style={{ fontSize: 28, fontWeight: 700 }}>{fmtNumber(data.total)}</div><div className="muted" style={{ fontSize: 12 }}>{totalLabel}</div></div>
        </div>
      </div>
      <div style={{ maxHeight: 220, overflow: 'auto', flex: 1, minWidth: 180 }}>
        {data.items.map((i) => (
          <div key={i.statusId} onClick={() => i.count && onSlice(i.statusId)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', cursor: i.count ? 'pointer' : 'default' }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: i.color, display: 'inline-block' }} />
            <span>{i.name}: <b>{fmtNumber(i.count)}</b></span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Bars({ rows }: { rows: { label: React.ReactNode; count: number }[] }) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return <div>{rows.map((row, index) => <div key={index} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 40px', alignItems: 'center', gap: 8, marginBottom: 4 }}>
    <div>{row.label}</div><div style={{ background: '#f0f0f0', borderRadius: 3, height: 10 }}><div style={{ width: `${row.count / max * 100}%`, background: '#f51d53', height: 10, borderRadius: 3 }} /></div><div style={{ textAlign: 'right' }}>{fmtNumber(row.count)}</div>
  </div>)}</div>;
}

const ACTION: Record<string, string> = { created: 'đã tạo', updated: 'đã cập nhật', status_changed: 'đã đổi trạng thái', commented: 'đã comment', triaged: 'đã duyệt', seen_again: 'ghi nhận xuất hiện lại', linked: 'đã liên kết', deleted: 'đã xóa' };

function ActivityFeed({ projectKey, initial, initialCursor, maxHeight }: { projectKey: string; initial: ActivityItem[]; initialCursor: string | null; maxHeight?: number | string }) {
  const [items, setItems] = useState<ActivityItem[]>(initial);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const { select } = useSelectedIssue();
  useEffect(() => { setItems(initial); setCursor(initialCursor); }, [initial, initialCursor]);
  const more = async () => {
    if (!cursor || loading) return;
    setLoading(true);
    try { const r = await getProjectActivity(projectKey, { cursor } as any); setItems((p) => [...p, ...r.items]); setCursor(r.nextCursor); } finally { setLoading(false); }
  };
  const groups = useMemo(() => {
    const g: { label: string; rows: ActivityItem[] }[] = [];
    for (const a of items) { const l = dayLabel(a.createdAt); const last = g[g.length - 1]; if (last?.label === l) last.rows.push(a); else g.push({ label: l, rows: [a] }); }
    return g;
  }, [items]);
  return (
    <div ref={box} style={{ maxHeight, overflow: 'auto' }} onScroll={(e) => { const el = e.currentTarget; if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) void more(); }}>
      {groups.length === 0 && <Typography.Text type="secondary">Chưa có hoạt động</Typography.Text>}
      {groups.map((g, gi) => (
        <div key={`${g.label}-${gi}`}>
          <div style={{ fontWeight: 600, margin: '8px 0', color: '#5e6c84' }}>{g.label}</div>
          {g.rows.map((a) => {
            const st = (a.changes as any)?.status as [string, string] | undefined;
            return (
              <div key={a.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0' }} title={fmtDateTime(a.createdAt)}>
                <UserAvatar user={a.actor ? { id: a.actor.id ?? 0, displayName: a.actor.displayName } : null} size={22} />
                <span><b>{a.actor?.displayName ?? 'Hệ thống'}</b> {ACTION[a.action] ?? a.action}{' '}
                  <a onClick={() => select(a.issueKey)}>{a.issueKey}</a> {a.issueTitle}
                  {st && <span className="muted"> · {st[0]} → {st[1]}</span>}</span>
              </div>
            );
          })}
        </div>
      ))}
      {loading && <div className="muted">Đang tải…</div>}
      {cursor && !loading && <Button type="link" onClick={more}>Tải thêm</Button>}
    </div>
  );
}

function ActivityExpand({ projectKey }: { projectKey: string }) {
  const [open, setOpen] = useState(false);
  const { data } = useQuery<any>({ queryKey: ['project-activity', projectKey], queryFn: () => getProjectActivity(projectKey, {} as any), enabled: open });
  return (
    <>
      <Button icon={<FullscreenOutlined />} type="text" onClick={() => setOpen(true)} aria-label="Mở rộng" />
      <Modal open={open} onCancel={() => setOpen(false)} footer={null} width="90vw" title="Recent activity" destroyOnHidden>
        {data && <ActivityFeed projectKey={projectKey} initial={data.items} initialCursor={data.nextCursor} maxHeight="70vh" />}
      </Modal>
    </>
  );
}
