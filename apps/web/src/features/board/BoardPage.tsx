import { fmtNumber } from '../../lib/number';
import { DownOutlined, EllipsisOutlined, RightOutlined } from '@ant-design/icons';
import { closestCorners, DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { App, Button, Dropdown, Input, Result, Select, Space, Tag } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { getBoard, rankIssue, transitionIssue } from '../../api/generated/api';
import { errorMessage } from '../../api/http';
import { useMembers, useProjectTracking, useSprints } from '../../api/hooks';
import type { IssueRow, Sprint } from '../../api/models';
import { AvatarFilter } from '../../components/AvatarFilter';
import { ErrorState } from '../../components/EmptyState';
import { IssueTypeIcon } from '../../components/IssueTypeIcon';
import { PriorityIcon } from '../../components/PriorityIcon';
import { SourceTag } from '../../components/SourceTag';
import { UserAvatar } from '../../components/UserAvatar';
import { fmtEstimate } from '../../lib/date';
import { usePermission } from '../auth/authStore';
import { CompleteSprintModal } from '../backlog/SprintModals';
import { useSelectedIssue } from '../issues/useSelectedIssue';
import { useUi } from '../../stores/ui';

interface Column { id: number; name: string; color: string; count?: number }
interface Lane { id: string; label: string; count: number; cells: Record<string, IssueRow[]> }
interface BoardData { sprint: Sprint | null; activePeriods?: Sprint[]; columns: Column[]; lanes: Lane[]; transitionMap: Record<string, string[]> }

const EMPTY: number[] = [];

/** Active sprint: cột sinh tự động từ workflow, không bao giờ có Pending Review (mục 6, 10). */
export default function BoardPage() {
  const { projectKey = '' } = useParams();
  const phase = useProjectTracking(projectKey) === 'phase';
  const [searchParams, setSearchParams] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { select } = useSelectedIssue();
  const canTransition = usePermission(projectKey, 'issue.transition');
  const canComplete = usePermission(projectKey, 'period.complete');
  const canEdit = usePermission(projectKey, 'issue.edit');
  const { data: members = [] } = useMembers(projectKey);
  const assignees = useUi((s) => s.assigneeFilter[projectKey] ?? EMPTY);
  const setAssignees = useUi((s) => s.setAssigneeFilter);
  const [q, setQ] = useState('');
  const [groupBy, setGroupBy] = useState<'none' | 'assignee' | 'parent'>('none');
  const params = { groupBy, q: q || undefined, assigneeIds: assignees.join(',') || undefined, sprintId: searchParams.get('sprintId') || undefined };
  const { data, isLoading, error, refetch } = useQuery<BoardData>({ queryKey: ['board', projectKey, params], queryFn: () => getBoard(projectKey, params as any) });
  const [board, setBoard] = useState<BoardData | null>(null);
  const [dragFrom, setDragFrom] = useState<{ issue: IssueRow; statusId: number } | null>(null);
  const [collapsedLanes, setCollapsedLanes] = useState<Set<string>>(new Set());
  const [completeOpen, setCompleteOpen] = useState(false);
  const { data: allSprints = [] } = useSprints(projectKey);
  useEffect(() => { setBoard(data ?? null); }, [data]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const allowed = useMemo(() => new Set(dragFrom && canTransition ? board?.transitionMap[String(dragFrom.statusId)] ?? [] : []), [dragFrom, board, canTransition]);

  const findCard = (id: string) => {
    for (const lane of board?.lanes ?? []) for (const [sid, list] of Object.entries(lane.cells)) {
      const issue = list.find((i) => String(i.id) === id);
      if (issue) return { lane, statusId: Number(sid), issue };
    }
    return null;
  };

  const onDragEnd = async (e: DragEndEvent) => {
    const from = dragFrom;
    setDragFrom(null);
    if (!from || !e.over || !board || (!canEdit && !canTransition)) return;
    const overId = String(e.over.id);
    let toStatus: number; let toLane: string; let overIssue: IssueRow | undefined;
    if (overId.startsWith('cell:')) { const [, laneId, sid] = overId.split(':'); toLane = laneId; toStatus = Number(sid); }
    else { const f = findCard(overId); if (!f) return; toLane = f.lane.id; toStatus = f.statusId; overIssue = f.issue; }
    const key = from.issue.key;

    if (toStatus !== from.statusId) {
      if (!canTransition) return;
      if (!allowed.has(String(toStatus))) { message.warning('Không có bước chuyển hợp lệ tới cột này'); return; }
      // lạc quan: chuyển thẻ sang cột mới
      const prev = board;
      setBoard({
        ...board,
        lanes: board.lanes.map((lane) => {
          const cells: Record<string, IssueRow[]> = {};
          for (const [sid, list] of Object.entries(lane.cells)) cells[sid] = list.filter((i) => i.id !== from.issue.id);
          if (lane.id === toLane) {
            const dest = [...(cells[String(toStatus)] ?? [])];
            const idx = overIssue ? dest.findIndex((i) => i.id === overIssue!.id) : dest.length;
            dest.splice(idx < 0 ? dest.length : idx, 0, { ...from.issue, statusId: toStatus });
            cells[String(toStatus)] = dest;
          }
          return { ...lane, cells };
        }),
      });
      try { await transitionIssue(key, { toStatusId: toStatus }); void qc.invalidateQueries(); }
      catch (err) { setBoard(prev); message.error(errorMessage(err)); void refetch(); }
      return;
    }
    // cùng cột: đổi thứ tự
    if (!canEdit || !overIssue || overIssue.id === from.issue.id) return;
    const prev = board;
    const lane = board.lanes.find((l) => l.id === toLane)!;
    const list = lane.cells[String(toStatus)];
    const fi = list.findIndex((i) => i.id === from.issue.id);
    const oi = list.findIndex((i) => i.id === overIssue!.id);
    if (fi < 0 || oi < 0) return;
    const next = [...list]; next.splice(fi, 1); next.splice(oi, 0, from.issue);
    setBoard({ ...board, lanes: board.lanes.map((l) => (l.id === toLane ? { ...l, cells: { ...l.cells, [String(toStatus)]: next } } : l)) });
    try { await rankIssue(key, (fi < oi ? { afterKey: overIssue.key } : { beforeKey: overIssue.key }) as any); }
    catch (err) { setBoard(prev); message.error(errorMessage(err)); }
  };

  if (error) return <ErrorState error={error} onRetry={refetch} />;
  const sprint = board?.sprint;

  return (
    <div className="page">
      <Space wrap style={{ marginBottom: 12, width: '100%' }}>
        <Input.Search placeholder="Search board" allowClear style={{ width: 200 }} onSearch={setQ} />
        <AvatarFilter users={members.map((m) => m.user)} value={assignees} onChange={(ids) => setAssignees(projectKey, ids)} />
        <Select value={groupBy} onChange={setGroupBy} style={{ width: 170 }} options={[{ value: 'none', label: 'Group: None' }, { value: 'assignee', label: 'Group: Assignee' }, { value: 'parent', label: 'Group: Sub-task' }]} />
        <div style={{ flex: 1 }} />
        {phase && !!board?.activePeriods?.length ? <Select aria-label="Phase đang thực hiện" style={{ minWidth: 200 }} value={sprint?.id} options={board.activePeriods.map((period) => ({ value: period.id, label: period.name }))} onChange={(id) => setSearchParams((prev) => { const next = new URLSearchParams(prev); next.set('sprintId', String(id)); return next; })} /> : sprint && <span className="muted">{sprint.name}</span>}
        {sprint && canComplete && <Button type="primary" onClick={() => setCompleteOpen(true)}>{phase ? 'Hoàn thành phase' : 'Complete sprint'}</Button>}
        {sprint && <Dropdown menu={{ items: [{ key: 'b', label: 'Mở Backlog', onClick: () => nav(`/projects/${projectKey}/backlog`) }] }}><Button icon={<EllipsisOutlined />} /></Dropdown>}
      </Space>

      {isLoading && !board ? <div className="muted">Đang tải…</div> : !sprint ? (
        <Result title={phase ? 'Chưa có phase đang thực hiện' : 'Chưa có sprint đang chạy'} subTitle={phase ? 'Hãy bắt đầu một phase trong Backlog hoặc Thông tin dự án.' : 'Hãy bắt đầu một sprint trong Backlog để thấy board.'} extra={<Button type="primary" onClick={() => nav(`/projects/${projectKey}/backlog`)}>Đi tới Backlog</Button>} />
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCorners}
          onDragStart={(e: DragStartEvent) => { const f = findCard(String(e.active.id)); if (f) setDragFrom({ issue: f.issue, statusId: f.statusId }); }}
          onDragEnd={onDragEnd} onDragCancel={() => setDragFrom(null)}>
          <div style={{ overflowX: 'auto' }}>
            <div style={{ display: 'flex', gap: 8, minWidth: board!.columns.length * 270, position: 'sticky', top: 0, zIndex: 2 }}>
              {board!.columns.map((c) => (
                <div key={c.id} style={{ flex: 1, minWidth: 260, padding: '4px 8px', fontWeight: 600, fontSize: 12, color: '#5e6c84', background: '#f5f6f8' }}>{c.name.toUpperCase()} {fmtNumber(c.count ?? 0)}</div>
              ))}
            </div>
            {board!.lanes.map((lane) => (
              <div key={lane.id} style={{ marginBottom: 12 }}>
                {(groupBy !== 'none') && (
                  <div style={{ margin: '6px 0', cursor: 'pointer', fontWeight: 600 }} onClick={() => setCollapsedLanes((s) => { const n = new Set(s); n.has(lane.id) ? n.delete(lane.id) : n.add(lane.id); return n; })}>
                    {collapsedLanes.has(lane.id) ? <RightOutlined /> : <DownOutlined />} {lane.label} <span className="muted">{fmtNumber(lane.count)}</span>
                  </div>
                )}
                {!collapsedLanes.has(lane.id) && (
                  <div style={{ display: 'flex', gap: 8, minWidth: board!.columns.length * 270 }}>
                    {board!.columns.map((c) => (
                      <Cell key={c.id} laneId={lane.id} column={c} cards={lane.cells[String(c.id)] ?? []} dim={!!dragFrom && c.id !== dragFrom.statusId && !allowed.has(String(c.id))}
                        canEdit={canEdit || canTransition} onOpen={(k) => select(k)} />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <DragOverlay>{dragFrom ? <CardView issue={dragFrom.issue} overlay /> : null}</DragOverlay>
        </DndContext>
      )}
      <CompleteSprintModal sprint={sprint ?? null} open={completeOpen && canComplete} onClose={() => setCompleteOpen(false)}
        done={allSprints.find((period) => period.id === sprint?.id)?.doneCount ?? (board?.lanes ?? []).reduce((a, l) => a + Object.values(l.cells).flat().filter((i) => i.status.category === 'done').length, 0)}
        notDone={allSprints.find((period) => period.id === sprint?.id)?.openCount ?? (board?.lanes ?? []).reduce((a, l) => a + Object.values(l.cells).flat().filter((i) => i.status.category !== 'done').length, 0)}
        futureSprints={allSprints.filter((s) => s.state === 'future')} />
    </div>
  );
}

function Cell({ laneId, column, cards, dim, canEdit, onOpen }: { laneId: string; column: Column; cards: IssueRow[]; dim: boolean; canEdit: boolean; onOpen: (key: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: `cell:${laneId}:${column.id}`, disabled: dim });
  return (
    <div ref={setNodeRef} className={`board-col${dim ? ' dim' : ''}`} data-testid={`col-${column.name}`} style={{ outline: isOver && !dim ? '2px dashed #f51d53' : undefined, minHeight: 80 }}>
      <SortableContext items={cards.map((c) => String(c.id))} strategy={verticalListSortingStrategy} disabled={!canEdit}>
        {cards.map((c) => <SortableCard key={c.id} issue={c} disabled={!canEdit} onOpen={() => onOpen(c.key)} />)}
      </SortableContext>
    </div>
  );
}

function SortableCard({ issue, disabled, onOpen }: { issue: IssueRow; disabled: boolean; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: String(issue.id), disabled });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} onClick={onOpen} data-testid={`card-${issue.key}`} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}>
      <CardView issue={issue} />
    </div>
  );
}

function CardView({ issue, overlay }: { issue: IssueRow; overlay?: boolean }) {
  return (
    <div className="card" style={overlay ? { boxShadow: '0 4px 12px rgba(0,0,0,.25)', width: 250 } : undefined}>
      <div className="t">{issue.title}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
        {issue.labels.filter((l) => !l.isSystem).map((l) => <Tag key={l.id} color={l.color} style={{ margin: 0 }}>{l.name}</Tag>)}
        {issue.source === 'auto' && <SourceTag source="auto" />}
        {issue.estimateMinutes ? <Tag style={{ margin: 0 }}>{fmtEstimate(issue.estimateMinutes)}</Tag> : null}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <IssueTypeIcon type={issue.type} /><span className="muted" style={{ fontSize: 12 }}>{issue.key}</span>
        <div style={{ flex: 1 }} />
        <PriorityIcon priority={issue.priority} />
        <UserAvatar user={issue.assignee} size={22} />
      </div>
    </div>
  );
}
