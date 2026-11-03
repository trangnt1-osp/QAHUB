import { fmtNumber } from '../../lib/number';
import {
  DownOutlined, EllipsisOutlined, HolderOutlined, PlusOutlined, RightOutlined,
} from '@ant-design/icons';
import {
  closestCenter, DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, useDroppable, useSensor, useSensors,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useVirtualizer } from '@tanstack/react-virtual';
import { App, Badge, Button, Checkbox, Dropdown, Input, Pagination, Popconfirm, Select, Space, Tag, Typography } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { ISSUE_TYPES, PRIORITIES } from '@ospm/shared';
import { bulkUpdateIssues, createIssue, createSprint, deleteSprint, getBacklog, listIssues, listSprints, rankIssue, transitionIssue } from '../../api/generated/api';
import { errorMessage } from '../../api/http';
import { useMembers, useProjectTracking, useSprints, useWorkflow } from '../../api/hooks';
import type { IssueRow, Sprint } from '../../api/models';
import { AvatarFilter } from '../../components/AvatarFilter';
import { EmptyState, ErrorState } from '../../components/EmptyState';
import { ISSUE_TYPE_LABEL, IssueTypeIcon } from '../../components/IssueTypeIcon';
import { LabelSelect } from '../../components/LabelSelect';
import { PriorityIcon } from '../../components/PriorityIcon';
import { SourceTag } from '../../components/SourceTag';
import { StatusTag } from '../../components/StatusTag';
import { UserAvatar } from '../../components/UserAvatar';
import { fmtDate, fmtEstimate } from '../../lib/date';
import { useAuth, usePermission } from '../auth/authStore';
import { useSelectedIssue } from '../issues/useSelectedIssue';
import { CompleteSprintModal, EditSprintModal, StartSprintModal } from './SprintModals';
import { useProjectStructure, type ProjectStructure } from '../project-structure';
import { ProjectImportButton } from '../project-import';

interface SprintBlock { sprint: Sprint; issues: IssueRow[]; totals: { total: number; visible: number; estimate: { todo: number; in_progress: number; done: number } } }
interface Layout { sprints: SprintBlock[]; backlog: IssueRow[]; backlogTotal: number; nextCursor: string | null }

type Row =
  | { kind: 'sprint'; id: string; block: SprintBlock }
  | { kind: 'issue'; id: string; issue: IssueRow; container: string; ordinal: number }
  | { kind: 'create'; id: string; container: string }
  | { kind: 'empty'; id: string; container: string }
  | { kind: 'backlog'; id: string }
  | { kind: 'pagination'; id: string; container: string; total: number };

const BACKLOG = 'backlog';
const FILTER_KEYS = ['q', 'assigneeIds', 'epicId', 'moduleId', 'functionId', 'sprintId', 'type', 'labelIds', 'source', 'statusIds'] as const;

export default function BacklogPage() {
  const { projectKey = '' } = useParams();
  const periodLabel = useProjectTracking(projectKey) === 'phase' ? 'phase' : 'sprint';
  const { data: periods = [] } = useSprints(projectKey);
  const [sp, setSp] = useSearchParams();
  const canEdit = usePermission(projectKey, 'issue.edit');
  const canCreate = usePermission(projectKey, 'issue.create');
  const canImport = usePermission(projectKey, 'issue.import');
  const canTransition = usePermission(projectKey, 'issue.transition');
  const canCreatePeriod = usePermission(projectKey, 'period.create');
  const canEditPeriod = usePermission(projectKey, 'period.edit');
  const canDeletePeriod = usePermission(projectKey, 'period.delete');
  const canStartPeriod = usePermission(projectKey, 'period.start');
  const canCompletePeriod = usePermission(projectKey, 'period.complete');
  const canDeleteOwn = usePermission(projectKey, 'issue.delete');
  const canDeleteAny = usePermission(projectKey, 'issue.delete.any');
  const user = useAuth((state) => state.user);
  const { data: members = [] } = useMembers(projectKey);
  const { data: wf } = useWorkflow(projectKey);
  const structure = useProjectStructure(projectKey);
  const qc = useQueryClient();
  const { message, modal } = App.useApp();
  const { select } = useSelectedIssue();

  // Bộ lọc lưu trên URL (mục 10)
  const filters = useMemo(() => {
    const f: Record<string, any> = {};
    for (const k of FILTER_KEYS) { const v = sp.get(k); if (v) f[k] = ['assigneeIds', 'type', 'labelIds', 'statusIds'].includes(k) ? v.split(',') : v; }
    return f;
  }, [sp]);
  const setFilter = (k: string, v: string | string[] | undefined) => setSp((p) => {
    const n = new URLSearchParams(p);
    const s = Array.isArray(v) ? v.join(',') : v;
    if (s) n.set(k, s); else n.delete(k);
    if (k === 'moduleId') n.delete('functionId');
    return n;
  }, { replace: true });
  const hasFilters = Object.keys(filters).length > 0;

  const { data, isLoading, error, refetch } = useQuery<any>({ queryKey: ['backlog', projectKey, filters], queryFn: () => getBacklog(projectKey, { ...filters, limit: 100 } as any) });
  const [layout, setLayout] = useState<Layout | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pages, setPages] = useState<Record<string, { current: number; pageSize: number }>>({});
  const scope = JSON.stringify([projectKey, filters]);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const generation = useRef(0);
  const [layoutGeneration, setLayoutGeneration] = useState(0);
  const request = useRef<object | null>(null);
  const pageFor = (container: string, total: number) => {
    const p = pages[container] ?? { current: 1, pageSize: 10 };
    return { ...p, current: Math.min(p.current, Math.max(1, Math.ceil(total / p.pageSize))) };
  };
  const backlogPage = pageFor(BACKLOG, layout?.backlogTotal ?? 0);

  useEffect(() => {
    setPages({});
    setLayout(null);
    setSelected(new Set());
    setLoadError(null);
  }, [scope]);

  useEffect(() => {
    generation.current += 1;
    setLayoutGeneration(generation.current);
    request.current = null;
    setLoadingMore(false);
    setLoadError(null);
    if (!data) return;
    setLayout({ sprints: data.sprints, backlog: data.backlog.issues, backlogTotal: data.backlog.total, nextCursor: data.backlog.nextCursor });
    setSelected(new Set());
  }, [data, scope]);

  const loadMore = useCallback(async () => {
    if (!layout?.nextCursor || request.current || layoutGeneration !== generation.current) return;
    const token = {};
    const version = generation.current;
    request.current = token;
    setLoadingMore(true);
    try {
      const r = await listIssues(projectKey, { ...filters, sprintId: 'backlog', cursor: layout.nextCursor, limit: 200 } as any);
      if (scopeRef.current !== scope || generation.current !== version) return;
      setLayout((l) => {
        if (!l || scopeRef.current !== scope || generation.current !== version) return l;
        const ids = new Set(l.backlog.map((i: IssueRow) => i.id));
        return { ...l, backlog: [...l.backlog, ...r.items.filter((i: IssueRow) => !ids.has(i.id))], nextCursor: r.nextCursor };
      });
    } catch (err) {
      if (scopeRef.current === scope && generation.current === version) setLoadError(errorMessage(err));
    } finally {
      if (request.current === token) {
        request.current = null;
        setLoadingMore(false);
      }
    }
  }, [layout?.nextCursor, layoutGeneration, projectKey, filters, scope]);

  useEffect(() => {
    if (layout && !loadError && !collapsed.has(BACKLOG) && layout.backlog.length < Math.min(backlogPage.current * backlogPage.pageSize, layout.backlogTotal)) void loadMore();
  }, [layout, backlogPage.current, backlogPage.pageSize, collapsed, loadError, loadMore]);

  // ---- Danh sách phẳng cho virtualizer: tiêu đề sprint, dòng item, dòng "+ Create", tiêu đề backlog ----
  const rows = useMemo<Row[]>(() => {
    if (!layout) return [];
    const out: Row[] = [];
    for (const b of layout.sprints) {
      const c = `s${b.sprint.id}`;
      out.push({ kind: 'sprint', id: `h-${c}`, block: b });
      if (!collapsed.has(c)) {
        if (!b.issues.length) out.push({ kind: 'empty', id: `e-${c}`, container: c });
        const page = pageFor(c, b.issues.length);
        const start = (page.current - 1) * page.pageSize;
        b.issues.slice(start, start + page.pageSize).forEach((i, index) => out.push({ kind: 'issue', id: String(i.id), issue: i, container: c, ordinal: start + index + 1 }));
        if (b.issues.length) out.push({ kind: 'pagination', id: `p-${c}`, container: c, total: b.issues.length });
        if (canCreate) out.push({ kind: 'create', id: `c-${c}`, container: c });
      }
    }
    out.push({ kind: 'backlog', id: 'h-backlog' });
    if (!collapsed.has(BACKLOG)) {
      if (!layout.backlog.length) out.push({ kind: 'empty', id: 'e-backlog', container: BACKLOG });
      const page = pageFor(BACKLOG, layout.backlogTotal);
      const start = (page.current - 1) * page.pageSize;
      layout.backlog.slice(start, start + page.pageSize).forEach((i, index) => out.push({ kind: 'issue', id: String(i.id), issue: i, container: BACKLOG, ordinal: start + index + 1 }));
      if (layout.backlogTotal) out.push({ kind: 'pagination', id: 'p-backlog', container: BACKLOG, total: layout.backlogTotal });
      if (canCreate) out.push({ kind: 'create', id: 'c-backlog', container: BACKLOG });
    }
    return out;
  }, [layout, collapsed, canCreate, pages]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length, getScrollElement: () => scrollRef.current, overscan: 12,
    estimateSize: (i) => (rows[i].kind === 'sprint' || rows[i].kind === 'backlog' || rows[i].kind === 'pagination' ? 64 : 42),
    getItemKey: (i) => rows[i].id,
  });
  const vItems = virtualizer.getVirtualItems();
  // ---- Kéo thả ----
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [dragging, setDragging] = useState<IssueRow | null>(null);
  const issueIds = useMemo(() => rows.filter((r) => r.kind === 'issue').map((r) => r.id), [rows]);

  const onDragEnd = async (e: DragEndEvent) => {
    setDragging(null);
    if (!layout || !e.over || !canEdit) return;
    const activeId = String(e.active.id);
    const overId = String(e.over.id);
    if (activeId === overId) return;
    const all = [...layout.sprints.flatMap((b) => b.issues.map((i) => ({ i, c: `s${b.sprint.id}` }))), ...layout.backlog.map((i) => ({ i, c: BACKLOG }))];
    const from = all.find((x) => String(x.i.id) === activeId);
    if (!from) return;
    let toContainer: string;
    let overIssue: { i: IssueRow; c: string } | undefined;
    if (overId.startsWith('drop-')) toContainer = overId.slice(5);
    else { overIssue = all.find((x) => String(x.i.id) === overId); if (!overIssue) return; toContainer = overIssue.c; }
    // Item chờ duyệt không được kéo vào sprint
    if (toContainer !== BACKLOG && from.i.status.category === 'triage') { message.warning('Cần duyệt bug trước'); return; }

    const targetList = (toContainer === BACKLOG ? layout.backlog : layout.sprints.find((b) => `s${b.sprint.id}` === toContainer)!.issues).filter((x) => x.id !== from.i.id);
    let body: Record<string, unknown> = {};
    let insertAt = targetList.length;
    if (overIssue) {
      const overIdx = targetList.findIndex((x) => x.id === overIssue!.i.id);
      const sameList = from.c === toContainer;
      const originalFromIdx = (from.c === BACKLOG ? layout.backlog : layout.sprints.find((b) => `s${b.sprint.id}` === from.c)!.issues).findIndex((x) => x.id === from.i.id);
      const originalOverIdx = (toContainer === BACKLOG ? layout.backlog : layout.sprints.find((b) => `s${b.sprint.id}` === toContainer)!.issues).findIndex((x) => x.id === overIssue!.i.id);
      const movingDown = sameList && originalFromIdx < originalOverIdx;
      insertAt = movingDown ? overIdx + 1 : overIdx;
      body = movingDown ? { afterKey: overIssue.i.key } : { beforeKey: overIssue.i.key };
    }
    if (toContainer !== from.c) body.sprintId = toContainer === BACKLOG ? null : Number(toContainer.slice(1));

    // Cập nhật lạc quan; lỗi thì hoàn tác bằng cách tải lại
    const moved = { ...from.i, sprintId: toContainer === BACKLOG ? null : Number(toContainer.slice(1)) };
    setLayout((l) => {
      if (!l) return l;
      const strip = (list: IssueRow[]) => list.filter((x) => x.id !== from.i.id);
      const put = (list: IssueRow[]) => { const n = strip(list); n.splice(Math.min(insertAt, n.length), 0, moved); return n; };
      return {
        ...l,
        backlog: toContainer === BACKLOG ? put(l.backlog) : strip(l.backlog),
        backlogTotal: l.backlogTotal + (from.c !== BACKLOG && toContainer === BACKLOG ? 1 : from.c === BACKLOG && toContainer !== BACKLOG ? -1 : 0),
        sprints: l.sprints.map((b) => ({ ...b, issues: `s${b.sprint.id}` === toContainer ? put(b.issues) : strip(b.issues) })),
      };
    });
    try { await rankIssue(from.i.key, body as any); void qc.invalidateQueries(); }
    catch (err) { message.error(errorMessage(err)); void refetch(); }
  };

  const changeStatus = async (issue: IssueRow, toStatusId: number) => {
    if (!canTransition) return;
    const prev = layout;
    try { await transitionIssue(issue.key, { toStatusId }); await qc.invalidateQueries(); } catch (e) { message.error(errorMessage(e)); setLayout(prev); }
  };

  // ---- Modal sprint ----
  const [startFor, setStartFor] = useState<Sprint | null>(null);
  const [editFor, setEditFor] = useState<Sprint | null>(null);
  const [completeFor, setCompleteFor] = useState<SprintBlock | null>(null);
  const [creatingSprint, setCreatingSprint] = useState(false);
  const addSprint = async () => {
    if (!canCreatePeriod || creatingSprint) return;
    setCreatingSprint(true);
    try {
      await createSprint(projectKey, {});
      await qc.invalidateQueries();
      message.success(`Đã tạo ${periodLabel}`);
    } catch (e) { message.error(errorMessage(e)); }
    finally { setCreatingSprint(false); }
  };
  const hasActive = layout?.sprints.some((b) => b.sprint.state === 'active');
  const completionCounts = periods.find((period) => period.id === completeFor?.sprint.id);
  const deletePeriod = async (period: Sprint) => {
    if (!canDeletePeriod) return;
    try {
      // Check fresh unfiltered counts, including completed and soft-deleted items.
      const current: (Sprint & { issueCount: number }) | undefined = (await listSprints(projectKey)).find((entry: Sprint) => entry.id === period.id);
      if (!current) { message.info('Sprint/phase không còn tồn tại'); await qc.invalidateQueries(); return; }
      const label = current.kind === 'phase' ? 'phase' : 'sprint';
      if (current.issueCount > 0) {
        modal.warning({ title: `Không thể xóa ${label}`, content: `Còn ${fmtNumber(current.issueCount)} item liên kết, kể cả item đã hoàn thành hoặc đã xóa. Hãy chuyển các item trước khi xóa.`, okText: 'Đã hiểu' });
        return;
      }
      await deleteSprint(String(current.id));
      await qc.invalidateQueries();
    } catch (e) { message.error(errorMessage(e)); }
  };

  if (error) return <ErrorState error={error} onRetry={refetch} />;

  return (
    <div className="page" style={{ paddingBottom: 0 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ minWidth: 0 }}><FilterBar projectKey={projectKey} filters={filters} setFilter={setFilter} clear={() => setSp({}, { replace: true })} hasFilters={hasFilters} members={members.map((m) => m.user)} structure={structure.data} loading={structure.isLoading} /></div>
        <ProjectImportButton projectKey={projectKey} scope="backlog" templateKind="backlog" canImport={canImport} />
        {canCreatePeriod && <Button type="primary" icon={<PlusOutlined />} loading={creatingSprint} onClick={addSprint} style={{ flexShrink: 0 }}>Tạo {periodLabel}</Button>}
      </div>
      {selected.size > 0 && (canEdit || canTransition || canDeleteOwn || canDeleteAny) && <BulkBar canEdit={canEdit} canTransition={canTransition} canDelete={canDeleteAny || (canDeleteOwn && [...selected].every((id) => layout?.sprints.flatMap((b) => b.issues).concat(layout.backlog).find((issue) => issue.id === id)?.reporter?.id === user?.id))} projectKey={projectKey} keys={[...selected].map((id) => layout!.sprints.flatMap((b) => b.issues).concat(layout!.backlog).find((i) => i.id === id)?.key).filter(Boolean) as string[]} onDone={() => { setSelected(new Set()); void qc.invalidateQueries(); }} statuses={wf?.statuses.filter((s) => !s.isArchived) ?? []} />}
      {isLoading || !layout ? <div className="muted" style={{ padding: 32 }}>Đang tải…</div> : hasFilters && !layout.backlogTotal && layout.sprints.every((block) => !block.issues.length) ? <EmptyState title="Không có item phù hợp." /> : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={(e: DragStartEvent) => setDragging(rows.find((r) => r.kind === 'issue' && r.id === String(e.active.id)) ? (rows.find((r) => r.id === String(e.active.id)) as any).issue : null)} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
          <div ref={scrollRef} style={{ height: 'calc(100vh - 290px)', minHeight: 360, overflow: 'auto', background: '#fff', border: '1px solid #f0f0f0', borderRadius: 6 }} data-testid="backlog-scroll">
            <SortableContext items={issueIds} strategy={verticalListSortingStrategy}>
              <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
                {vItems.map((v) => {
                  const r = rows[v.index];
                  return (
                    <div key={r.id} style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${v.start}px)`, height: v.size }}>
                      {r.kind === 'sprint' && (
                        <SprintHeader block={r.block} collapsed={collapsed.has(`s${r.block.sprint.id}`)} hasFilters={hasFilters} canEdit={canEditPeriod} canStart={canStartPeriod} canComplete={canCompletePeriod} canDelete={canDeletePeriod} hasActive={!!hasActive}
                          toggle={() => setCollapsed((c) => { const n = new Set(c); const k = `s${r.block.sprint.id}`; n.has(k) ? n.delete(k) : n.add(k); return n; })}
                          onStart={() => setStartFor(r.block.sprint)} onComplete={() => setCompleteFor(r.block)} onEdit={() => setEditFor(r.block.sprint)}
                          onDelete={() => void deletePeriod(r.block.sprint)} />
                      )}
                      {r.kind === 'backlog' && (
                        <BacklogHeader total={layout.backlogTotal} collapsed={collapsed.has(BACKLOG)} canEdit={canCreatePeriod}
                          toggle={() => setCollapsed((c) => { const n = new Set(c); n.has(BACKLOG) ? n.delete(BACKLOG) : n.add(BACKLOG); return n; })}
                          periodLabel={periodLabel} onCreateSprint={addSprint} />
                      )}
                      {r.kind === 'issue' && (
                        <IssueRowView ordinal={r.ordinal} issue={r.issue} canEdit={canEdit} canTransition={canTransition} checked={selected.has(r.issue.id)} projectKey={projectKey}
                          onCheck={(c) => setSelected((s) => { const n = new Set(s); c ? n.add(r.issue.id) : n.delete(r.issue.id); return n; })}
                          onOpen={() => select(r.issue.key)} onStatus={(sid) => changeStatus(r.issue, sid)} />
                      )}
                      {r.kind === 'pagination' && <div data-testid={`pagination-${r.container}`} style={{ padding: '10px 12px' }}>
                        <Pagination size="small" current={pageFor(r.container, r.total).current} pageSize={pageFor(r.container, r.total).pageSize} total={r.total} showSizeChanger={{ getPopupContainer: () => document.body }} pageSizeOptions={[10, 20, 50, 100]} showTotal={(total) => `${fmtNumber(total)} items`} onChange={(current, pageSize) => { setLoadError(null); setPages((p) => ({ ...p, [r.container]: { current: (p[r.container]?.pageSize ?? 10) !== pageSize ? 1 : current, pageSize } })); }} />
                        {r.container === BACKLOG && loadError && <span role="alert">{loadError} <Button size="small" onClick={() => setLoadError(null)}>Retry</Button></span>}
                      </div>}
                      {r.kind === 'empty' && <EmptyDrop container={r.container} />}
                      {r.kind === 'create' && <QuickCreate projectKey={projectKey} sprintId={r.container === BACKLOG ? undefined : Number(r.container.slice(1))} parentKey={structure.data?.epics.find((epic) => String(epic.id) === filters.epicId)?.key} moduleId={filters.moduleId ? Number(filters.moduleId) : undefined} functionId={filters.functionId ? Number(filters.functionId) : undefined} onCreated={() => qc.invalidateQueries()} />}
                    </div>
                  );
                })}
              </div>
            </SortableContext>
            {loadingMore && <div className="muted" style={{ padding: 8, textAlign: 'center' }}>Đang tải thêm…</div>}
          </div>
          <DragOverlay>{dragging ? <div style={{ background: '#fff', border: '1px solid #f51d53', padding: '8px 12px', borderRadius: 4 }}><IssueTypeIcon type={dragging.type} /> {dragging.key} {dragging.title}</div> : null}</DragOverlay>
        </DndContext>
      )}
      <StartSprintModal sprint={startFor} open={!!startFor && canStartPeriod} onClose={() => setStartFor(null)} />
      <EditSprintModal sprint={editFor} open={!!editFor && canEditPeriod} onClose={() => setEditFor(null)} />
      <CompleteSprintModal sprint={completeFor?.sprint ?? null} open={!!completeFor && canCompletePeriod} onClose={() => setCompleteFor(null)}
        done={completionCounts?.doneCount ?? (completeFor ? completeFor.issues.filter((i) => i.status.category === 'done').length : 0)}
        notDone={completionCounts?.openCount ?? (completeFor ? completeFor.issues.filter((i) => i.status.category !== 'done').length : 0)}
        futureSprints={(layout?.sprints ?? []).filter((b) => b.sprint.state === 'future').map((b) => b.sprint)} />
    </div>
  );
}

function FilterBar({ projectKey, filters, setFilter, clear, hasFilters, members, structure, loading }: {
  projectKey: string; filters: Record<string, any>; setFilter: (k: string, v: string | string[] | undefined) => void; clear: () => void; hasFilters: boolean; members: { id: number; displayName: string }[];
  structure?: ProjectStructure; loading?: boolean;
}) {
  const { data: wf } = useWorkflow(projectKey);
  const { data: periods = [] } = useSprints(projectKey);
  const phase = useProjectTracking(projectKey) === 'phase';
  const [q, setQ] = useState<string>(filters.q ?? '');
  useEffect(() => { const t = setTimeout(() => q !== (filters.q ?? '') && setFilter('q', q || undefined), 300); return () => clearTimeout(t); }, [q]);
  return (
    <Space wrap style={{ marginBottom: 12 }}>
      <Input.Search placeholder="Search backlog" allowClear style={{ width: 220 }} value={q} onChange={(e) => setQ(e.target.value)} />
      <AvatarFilter users={members} value={(filters.assigneeIds ?? []).map(Number)} onChange={(ids) => setFilter('assigneeIds', ids.map(String))} />
      <Select aria-label="Lọc Epic" allowClear placeholder="Epic" style={{ width: 180 }} loading={loading} showSearch optionFilterProp="label" value={filters.epicId ? Number(filters.epicId) : undefined} onChange={(v) => setFilter('epicId', v ? String(v) : undefined)}
        options={(structure?.epics ?? []).map((epic) => ({ value: epic.id, label: `${epic.code} · ${epic.name}` }))} />
      <Select aria-label="Lọc Module" allowClear placeholder="Module" style={{ width: 160 }} loading={loading} showSearch optionFilterProp="label" value={filters.moduleId ? Number(filters.moduleId) : undefined} onChange={(v) => setFilter('moduleId', v ? String(v) : undefined)}
        options={(structure?.modules ?? []).map((module) => ({ value: module.id, label: `${module.code} · ${module.name}` }))} />
      <Select aria-label="Lọc Function" allowClear placeholder="Function" style={{ width: 170 }} loading={loading} showSearch optionFilterProp="label" value={filters.functionId ? Number(filters.functionId) : undefined} onChange={(v) => setFilter('functionId', v ? String(v) : undefined)}
        options={(structure?.functions ?? []).filter((fn) => !filters.moduleId || String(fn.moduleId) === filters.moduleId).map((fn) => ({ value: fn.id, label: `${fn.code} · ${fn.name}` }))} />
      <Select aria-label={phase ? 'Lọc Phase' : 'Lọc Sprint'} allowClear placeholder={phase ? 'Phase' : 'Sprint'} style={{ width: 160 }} value={filters.sprintId} onChange={(value) => setFilter('sprintId', value)}
        options={[{ value: 'backlog', label: 'Chưa phân bổ' }, ...periods.map((period) => ({ value: String(period.id), label: period.name }))]} />
      <Select mode="multiple" allowClear placeholder="Type" style={{ minWidth: 120 }} maxTagCount="responsive" value={filters.type} onChange={(v) => setFilter('type', v)} options={ISSUE_TYPES.map((t) => ({ value: t, label: ISSUE_TYPE_LABEL[t] }))} />
      <LabelSelect projectKey={projectKey} value={(filters.labelIds ?? []).map(Number)} onChange={(ids) => setFilter('labelIds', ids.map(String))} />
      <Select allowClear placeholder="Source" style={{ width: 120 }} value={filters.source} onChange={(v) => setFilter('source', v)} options={[{ value: 'manual', label: 'Manual' }, { value: 'auto', label: 'Auto' }]} />
      <Select mode="multiple" allowClear placeholder="Status" style={{ minWidth: 140 }} maxTagCount="responsive" value={filters.statusIds} onChange={(v) => setFilter('statusIds', v)}
        options={(wf?.statuses ?? []).filter((s) => !s.isArchived).map((s) => ({ value: String(s.id), label: s.name }))} />
      {hasFilters && <Button type="link" onClick={clear}>Clear filters</Button>}
    </Space>
  );
}

const EST_COLORS = { todo: '#dfe1e6', in_progress: '#4c9aff', done: '#36b37e' };

function SprintHeader({ block, collapsed, toggle, hasFilters, canEdit, canStart, canComplete, canDelete, hasActive, onStart, onComplete, onEdit, onDelete }: {
  block: SprintBlock; collapsed: boolean; toggle: () => void; hasFilters: boolean; canEdit: boolean; canStart: boolean; canComplete: boolean; canDelete: boolean; hasActive: boolean;
  onStart: () => void; onComplete: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const { sprint, totals } = block;
  const label = sprint.kind === 'phase' ? 'phase' : 'sprint';
  const { setNodeRef, isOver } = useDroppable({ id: `drop-s${sprint.id}` });
  return (
    <div ref={setNodeRef} data-testid={`period-header-${sprint.id}`} style={{ background: isOver ? '#ffe0e9' : '#f7f8f9', padding: '8px 12px', borderBottom: '1px solid #f0f0f0', height: '100%', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <a onClick={toggle}>{collapsed ? <RightOutlined /> : <DownOutlined />}</a>
        <b>{sprint.name}</b>
        {sprint.startDate && <span className="muted">{fmtDate(sprint.startDate)} – {fmtDate(sprint.endDate)}</span>}
        <span className="muted">({fmtNumber(totals.visible)} of {fmtNumber(totals.total)} work items visible)</span>
        {sprint.state === 'active' && <Tag color="blue">Active</Tag>}
        <div style={{ flex: 1 }} />
        {(['todo', 'in_progress', 'done'] as const).map((k) => <Badge key={k} count={fmtEstimate(totals.estimate[k]) || '0'} showZero color={EST_COLORS[k]} style={{ color: k === 'todo' ? '#42526e' : '#fff' }} />)}
        {canStart && sprint.state === 'future' && <Button size="small" disabled={label === 'sprint' && hasActive} title={label === 'sprint' && hasActive ? 'Dự án đã có sprint đang chạy' : undefined} onClick={onStart}>{label === 'phase' ? 'Bắt đầu phase' : 'Start sprint'}</Button>}
        {canComplete && sprint.state === 'active' && <Button size="small" type="primary" onClick={onComplete}>{label === 'phase' ? 'Hoàn thành phase' : 'Complete sprint'}</Button>}
        {(canEdit || (canDelete && sprint.state !== 'active')) && (
          <Dropdown menu={{ items: [...(canEdit ? [{ key: 'edit', label: `Sửa ${label}`, onClick: onEdit }] : []), ...(canDelete && sprint.state !== 'active' ? [{ key: 'del', danger: true, label: `Xóa ${label}`, onClick: onDelete }] : [])] }}>
            <Button size="small" type="text" aria-label={`Thao tác ${sprint.name}`} icon={<EllipsisOutlined />} />
          </Dropdown>
        )}
      </div>
      {sprint.goal && <div className="muted" style={{ marginLeft: 24, fontSize: 12 }}>{sprint.goal}</div>}
      {hasFilters && void 0}
    </div>
  );
}

function BacklogHeader({ total, collapsed, toggle, canEdit, onCreateSprint, periodLabel }: { total: number; collapsed: boolean; toggle: () => void; canEdit: boolean; onCreateSprint: () => void; periodLabel: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'drop-backlog' });
  return (
    <div ref={setNodeRef} style={{ background: isOver ? '#ffe0e9' : '#f7f8f9', padding: '8px 12px', borderBottom: '1px solid #f0f0f0', height: '100%', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 8 }}>
      <a onClick={toggle}>{collapsed ? <RightOutlined /> : <DownOutlined />}</a>
      <b>Backlog</b><span className="muted">({fmtNumber(total)} work items)</span>
      <div style={{ flex: 1 }} />
      {canEdit && <Button size="small" onClick={onCreateSprint}>{periodLabel === 'phase' ? 'Tạo phase' : 'Create sprint'}</Button>}
    </div>
  );
}

function EmptyDrop({ container }: { container: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: `drop-${container}` });
  return <div ref={setNodeRef} className="muted" style={{ padding: '10px 36px', background: isOver ? '#ffe0e9' : '#fff', border: '1px dashed #d9d9d9', margin: 4 }}>Kéo item vào đây</div>;
}

const IssueRowView = memo(function IssueRowView({ ordinal, issue, canEdit, canTransition, checked, onCheck, onOpen, onStatus, projectKey }: {
  ordinal: number; issue: IssueRow; canEdit: boolean; canTransition: boolean; checked: boolean; onCheck: (c: boolean) => void; onOpen: () => void; onStatus: (id: number) => void; projectKey: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: String(issue.id), disabled: !canEdit });
  const { data: wf } = useWorkflow(projectKey);
  const transitions = useMemo(() => {
    if (!wf?.settings || issue.status.category === 'triage') return [];
    return wf.statuses.filter((s) => !s.isArchived && s.id !== issue.statusId && (wf.settings!.allowAnyTransition || wf.transitions.some((t) => t.toStatusId === s.id && (t.fromStatusId === issue.statusId || t.fromStatusId === null))))
      .map((s) => ({ statusId: s.id, name: s.name, category: s.category, color: s.color, label: null }));
  }, [wf, issue.statusId, issue.status.category]);
  return (
    <div ref={setNodeRef} className="issue-row" data-testid={`issue-row-${issue.key}`} onClick={onOpen}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1, height: '100%', boxSizing: 'border-box' }}>
      {canEdit && <span {...attributes} {...listeners} onClick={(e) => e.stopPropagation()} style={{ cursor: 'grab', color: '#bfbfbf' }}><HolderOutlined /></span>}
      <span onClick={(e) => e.stopPropagation()}><Checkbox checked={checked} onChange={(e) => onCheck(e.target.checked)} /></span>
      <span className="muted" aria-label="STT" style={{ minWidth: 36, textAlign: 'right' }}>{fmtNumber(ordinal)}</span>
      <IssueTypeIcon type={issue.type} />
      <span className="muted" style={{ width: 84 }}>{issue.key}</span>
      <span className="title">{issue.title}</span>
      {issue.parent && <Tag style={{ margin: 0 }}>{issue.type === 'subtask' ? `Subtask of ${issue.parent.key}` : issue.parent.key}</Tag>}
      {issue.labels.filter((l) => !l.isSystem).slice(0, 2).map((l) => <Tag key={l.id} color={l.color} style={{ margin: 0 }}>{l.name}</Tag>)}
      {issue.source === 'auto' && <SourceTag source="auto" />}
      <StatusTag status={issue.status} transitions={transitions} onTransition={canTransition ? onStatus : undefined} />
      <span className="muted" style={{ width: 48, textAlign: 'right' }}>{fmtEstimate(issue.estimateMinutes)}</span>
      <PriorityIcon priority={issue.priority} />
      <UserAvatar user={issue.assignee} size={22} />
    </div>
  );
});

function QuickCreate({ projectKey, sprintId, parentKey, moduleId, functionId, onCreated }: { projectKey: string; sprintId?: number; parentKey?: string; moduleId?: number; functionId?: number; onCreated: () => void }) {
  const canCreate = usePermission(projectKey, 'issue.create');
  const [active, setActive] = useState(false);
  const [title, setTitle] = useState('');
  const [type, setType] = useState('task');
  const { message } = App.useApp();
  const submit = async () => {
    if (!canCreate || !title.trim()) return;
    try { await createIssue(projectKey, { type: type as any, title: title.trim(), sprintId, parentKey: type === 'epic' ? undefined : parentKey, moduleIds: moduleId ? [moduleId] : undefined, functionIds: functionId ? [functionId] : undefined } as any); setTitle(''); onCreated(); }
    catch (e) { message.error(errorMessage(e)); }
  };
  if (!canCreate) return null;
  if (!active) return <div className="issue-row" style={{ height: '100%', boxSizing: 'border-box' }} onClick={() => setActive(true)}><PlusOutlined /> <span className="muted">Create</span></div>;
  return (
    <div className="issue-row" style={{ height: '100%', boxSizing: 'border-box' }} onBlur={(event) => {
      if (!title && !event.currentTarget.contains(event.relatedTarget as Node | null)) setActive(false);
    }}>
      <Select size="small" value={type} onChange={setType} style={{ width: 110 }} options={ISSUE_TYPES.filter((t) => t !== 'subtask').map((t) => ({ value: t, label: ISSUE_TYPE_LABEL[t] }))} />
      <Input size="small" autoFocus placeholder="Bạn cần làm gì? (Enter để tạo)" value={title} onChange={(e) => setTitle(e.target.value)} onPressEnter={submit} onKeyDown={(e) => e.key === 'Escape' && setActive(false)} />
    </div>
  );
}

function BulkBar({ projectKey, keys, statuses, onDone, canEdit, canTransition, canDelete }: { canEdit: boolean; canTransition: boolean; canDelete: boolean; projectKey: string; keys: string[]; statuses: { id: number; name: string }[]; onDone: () => void }) {
  const phase = useProjectTracking(projectKey) === 'phase';
  const { data: members = [] } = useMembers(projectKey);
  const { data: sprints = [] } = useSprints(projectKey);
  const { message } = App.useApp();
  const run = async (set: Record<string, unknown>) => {
    if (set.deleted ? !canDelete : 'statusId' in set ? !canTransition : !canEdit) return;
    try { await bulkUpdateIssues(projectKey, { issueKeys: keys, set: set as any }); message.success(`Đã cập nhật ${fmtNumber(keys.length)} item`); onDone(); }
    catch (e) { message.error(errorMessage(e)); }
  };
  return (
    <Space wrap style={{ marginBottom: 8, padding: 8, background: '#ffe0e9', borderRadius: 6, width: '100%' }}>
      <Typography.Text strong>{fmtNumber(keys.length)} đã chọn</Typography.Text>
      <Select disabled={!canEdit} size="small" placeholder={phase ? 'Chuyển phase' : 'Chuyển sprint'} style={{ width: 150 }} onChange={(v) => run({ sprintId: v === 'backlog' ? null : v })} value={undefined}
        options={[{ value: 'backlog', label: 'Backlog' }, ...sprints.map((s) => ({ value: s.id, label: s.name }))]} />
      <Select disabled={!canTransition} size="small" placeholder="Đổi trạng thái" style={{ width: 150 }} onChange={(v) => run({ statusId: v })} value={undefined} options={statuses.map((s) => ({ value: s.id, label: s.name }))} />
      <Select disabled={!canEdit} size="small" placeholder="Gán người" style={{ width: 150 }} showSearch optionFilterProp="label" onChange={(v) => run({ assigneeId: v })} value={undefined} options={members.map((m) => ({ value: m.userId, label: m.user.displayName }))} />
      <Select disabled={!canEdit} size="small" placeholder="Priority" style={{ width: 110 }} onChange={(v) => run({ priority: v })} value={undefined} options={PRIORITIES.map((p) => ({ value: p, label: p }))} />
      {canEdit && <LabelSelect projectKey={projectKey} value={[]} onChange={(ids) => ids.length && run({ labelIds: ids })} placeholder="Thêm label" style={{ minWidth: 130 }} />}
      {canDelete && <Popconfirm title={`Xóa ${fmtNumber(keys.length)} item?`} okButtonProps={{ danger: true }} onConfirm={() => run({ deleted: true })}><Button size="small" danger>Xóa</Button></Popconfirm>}
    </Space>
  );
}
