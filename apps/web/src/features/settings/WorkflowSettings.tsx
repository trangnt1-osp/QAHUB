import { DeleteOutlined, HolderOutlined, PlusOutlined } from '@ant-design/icons';
import { DndContext, DragEndEvent, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Alert, App, Button, Card, Checkbox, ColorPicker, Input, List, Modal, Select, Space, Switch, Tooltip, Typography } from 'antd';
import { ListTable } from '../../components/ListTable';
import { NumberedList } from '../../components/NumberedList';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { STATUS_CATEGORIES, StatusCategory } from '@ospm/shared';
import { applyWorkflowTemplate, saveWorkflow } from '../../api/generated/api';
import { errorCode, errorMessage } from '../../api/http';
import { useWorkflow, useWorkflowTemplates } from '../../api/hooks';
import { QueryBoundary } from '../../components/EmptyState';

interface Row { ref: string; id?: number; name: string; category: StatusCategory; color: string; showOnBoard: boolean; issueCount: number }
interface State {
  rows: Row[];
  /** "from->to" với from = ref hoặc '*' (từ mọi trạng thái) */
  pairs: Set<string>;
  names: Record<string, string>;
  allowAny: boolean;
  initialManual?: string; initialAuto?: string; accept?: string; reject?: string;
}

const CATEGORY_LABEL: Record<string, string> = { triage: 'triage (chờ duyệt)', todo: 'todo', in_progress: 'in_progress', done: 'done' };
let tmp = 0;

function SortableRow({ row, serial, onChange, onArchive }: { row: Row; serial: number; onChange: (r: Row) => void; onArchive: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: row.ref });
  const triage = row.category === 'triage';
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, display: 'grid', width: '100%', gridTemplateColumns: '44px 24px 1fr 190px 48px 150px 40px', gap: 8, alignItems: 'center', padding: '6px 0', background: '#fff' }}>
      <span aria-label="STT" className="muted">{serial}</span>
      <span {...attributes} {...listeners} style={{ cursor: 'grab', color: '#bfbfbf' }}><HolderOutlined /></span>
      <Input value={row.name} onChange={(e) => onChange({ ...row, name: e.target.value })} />
      <Select value={row.category} onChange={(c) => onChange({ ...row, category: c, showOnBoard: c === 'triage' ? false : row.showOnBoard })} options={STATUS_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))} />
      <ColorPicker value={row.color} onChange={(c) => onChange({ ...row, color: c.toHexString() })} />
      <Tooltip title={triage ? 'Trạng thái triage không bao giờ hiển thị trên board' : undefined}>
        <span><Switch size="small" checked={!triage && row.showOnBoard} disabled={triage} onChange={(v) => onChange({ ...row, showOnBoard: v })} /> <span className="muted">Hiện trên board</span></span>
      </Tooltip>
      <Tooltip title={row.issueCount ? `Đang có ${row.issueCount} item — sẽ phải chọn trạng thái thay thế` : 'Lưu trữ'}><Button type="text" danger icon={<DeleteOutlined />} onClick={onArchive} /></Tooltip>
    </div>
  );
}

/** Cấu hình workflow theo dự án: trạng thái, ma trận chuyển, 4 ô trạng thái đặc biệt, xem trước sơ đồ, áp dụng template. */
export function WorkflowSettings() {
  const { projectKey = '' } = useParams();
  const { data: wf, isLoading, error, refetch } = useWorkflow(projectKey);
  const { data: templates = [] } = useWorkflowTemplates();
  const qc = useQueryClient();
  const { message, modal } = App.useApp();
  const [st, setSt] = useState<State | null>(null);
  const [saving, setSaving] = useState(false);
  const [replace, setReplace] = useState<{ removed: Row[]; map: Record<string, string> } | null>(null);
  const [tplId, setTplId] = useState<number>();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => {
    if (!wf) return;
    const rows: Row[] = wf.statuses.filter((s) => !s.isArchived).map((s) => ({ ref: String(s.id), id: s.id, name: s.name, category: s.category, color: s.color, showOnBoard: s.showOnBoard, issueCount: s.issueCount ?? 0 }));
    const pairs = new Set(wf.transitions.map((t) => `${t.fromStatusId ?? '*'}->${t.toStatusId}`));
    const names: Record<string, string> = {};
    for (const t of wf.transitions) if (t.name) names[`${t.fromStatusId ?? '*'}->${t.toStatusId}`] = t.name;
    const s = wf.settings;
    setSt({ rows, pairs, names, allowAny: !!s?.allowAnyTransition, initialManual: s ? String(s.initialManualStatusId) : undefined, initialAuto: s ? String(s.initialAutoStatusId) : undefined, accept: s?.acceptStatusId ? String(s.acceptStatusId) : undefined, reject: s?.rejectStatusId ? String(s.rejectStatusId) : undefined });
  }, [wf]);

  const statusOptions = useMemo(() => (st?.rows ?? []).map((r) => ({ value: r.ref, label: r.name || '(chưa đặt tên)' })), [st?.rows]);
  if (error) return <QueryBoundary isLoading={false} error={error} refetch={refetch}><div /></QueryBoundary>;
  if (isLoading || !st || !wf) return <QueryBoundary isLoading><div /></QueryBoundary>;

  const patch = (p: Partial<State>) => setSt({ ...st, ...p });
  const originalActive = wf.statuses.filter((s) => !s.isArchived);

  const buildBody = (map?: Record<string, string>) => ({
    statuses: st.rows.map((r) => ({ ...(r.id ? { id: r.id } : { tempKey: r.ref }), name: r.name.trim(), category: r.category, color: r.color, showOnBoard: r.category === 'triage' ? false : r.showOnBoard })),
    transitions: [...st.pairs].filter((p) => { const [f, t] = p.split('->'); return (f === '*' || st.rows.some((r) => r.ref === f)) && st.rows.some((r) => r.ref === t); })
      .map((p) => { const [f, t] = p.split('->'); return { from: f === '*' ? null : f, to: t, name: st.names[p] }; }),
    settings: { initialManual: st.initialManual!, initialAuto: st.initialAuto!, accept: st.accept ?? null, reject: st.reject ?? null, allowAnyTransition: st.allowAny },
    ...(map ? { statusReplacements: map } : {}),
  });

  const doSave = async (map?: Record<string, string>) => {
    setSaving(true);
    try {
      await saveWorkflow(projectKey, buildBody(map) as any);
      message.success('Đã lưu workflow — board sẽ đổi cột ở lần tải tiếp theo');
      setReplace(null);
      await qc.invalidateQueries();
    } catch (e) {
      if (errorCode(e) === 'STATUS_IN_USE') message.error(errorMessage(e)); else message.error(errorMessage(e));
    } finally { setSaving(false); }
  };

  const save = async () => {
    if (st.rows.some((r) => !r.name.trim())) return message.error('Mọi trạng thái cần có tên');
    if (!st.initialManual || !st.initialAuto) return message.error('Chọn trạng thái khởi tạo Manual và Auto');
    const removed = originalActive.filter((o) => !st.rows.some((r) => r.id === o.id));
    const needReplacement = removed.filter((r) => (r.issueCount ?? 0) > 0);
    if (needReplacement.length) {
      setReplace({ removed: needReplacement.map((r) => ({ ref: String(r.id), id: r.id, name: r.name, category: r.category, color: r.color, showOnBoard: r.showOnBoard, issueCount: r.issueCount ?? 0 })), map: {} });
      return;
    }
    await doSave();
  };

  const togglePair = (f: string, t: string) => {
    const k = `${f}->${t}`;
    const n = new Set(st.pairs);
    n.has(k) ? n.delete(k) : n.add(k);
    patch({ pairs: n });
  };

  const applyTemplate = () => {
    if (!tplId) return;
    modal.confirm({
      title: 'Áp dụng template?', content: 'Toàn bộ trạng thái và bước chuyển hiện tại sẽ được thay bằng template. Item đang có sẽ được chuyển sang trạng thái cùng nhóm.',
      okText: 'Áp dụng', cancelText: 'Hủy',
      onOk: async () => { try { await applyWorkflowTemplate(projectKey, { templateId: tplId }); message.success('Đã áp dụng template'); await qc.invalidateQueries(); } catch (e) { message.error(errorMessage(e)); } },
    });
  };

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card title="Trạng thái" extra={<Space>
        <Select placeholder="Chọn template" style={{ width: 180 }} value={tplId} onChange={setTplId} options={templates.map((t) => ({ value: t.id, label: t.name }))} />
        <Button onClick={applyTemplate} disabled={!tplId}>Áp dụng template</Button>
      </Space>}>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e: DragEndEvent) => {
          if (!e.over || e.active.id === e.over.id) return;
          patch({ rows: arrayMove(st.rows, st.rows.findIndex((r) => r.ref === e.active.id), st.rows.findIndex((r) => r.ref === e.over!.id)) });
        }}>
          <SortableContext items={st.rows.map((r) => r.ref)} strategy={verticalListSortingStrategy}>
            <NumberedList<Row> split={false} rowKey="ref" dataSource={st.rows} resetKey={projectKey} renderItem={(r, index) => (
              <List.Item style={{ padding: 0 }}><SortableRow row={r} serial={index + 1} onChange={(n) => patch({ rows: st.rows.map((x) => (x.ref === r.ref ? n : x)) })}
                onArchive={() => patch({ rows: st.rows.filter((x) => x.ref !== r.ref), pairs: new Set([...st.pairs].filter((p) => !p.split('->').includes(r.ref))) })} /></List.Item>
            )} />
          </SortableContext>
        </DndContext>
        <Button icon={<PlusOutlined />} style={{ marginTop: 8 }} onClick={() => patch({ rows: [...st.rows, { ref: `new-${++tmp}`, name: '', category: 'in_progress', color: '#f51d53', showOnBoard: true, issueCount: 0 }] })}>Thêm trạng thái</Button>
        <Alert type="info" showIcon style={{ marginTop: 12 }} message="Board hiển thị các trạng thái theo đúng thứ tự ở đây, trừ nhóm triage (Pending Review không bao giờ là một cột)." />
      </Card>

      <Card title="Ma trận chuyển trạng thái" extra={<Space><Switch checked={st.allowAny} onChange={(v) => patch({ allowAny: v })} /> Cho phép chuyển tự do</Space>}>
        <ListTable size="small" rowKey="ref" scroll={{ x: true }} resetKey={projectKey} dataSource={[{ ref: '*', name: 'Từ mọi trạng thái' } as any, ...st.rows]}
          columns={[
            { title: 'Từ \\ Đến', dataIndex: 'name', fixed: 'left', width: 170, render: (n, r: any) => (r.ref === '*' ? <i>{n}</i> : n || '(chưa đặt tên)') },
            ...st.rows.map((to) => ({
              title: to.name || '…', width: 110, align: 'center' as const,
              render: (_: unknown, from: any) => from.ref === to.ref ? <span className="muted">—</span> : (
                <Checkbox disabled={st.allowAny} checked={st.allowAny || st.pairs.has(`${from.ref}->${to.ref}`)} onChange={() => togglePair(from.ref, to.ref)} aria-label={`${from.name} -> ${to.name}`} />
              ),
            })),
          ]} />
      </Card>

      <Card title="Trạng thái đặc biệt">
        <Space wrap size="large">
          <label>Khởi tạo Manual<br /><Select style={{ width: 200 }} value={st.initialManual} onChange={(v) => patch({ initialManual: v })} options={statusOptions.filter((o) => st.rows.find((r) => r.ref === o.value)?.category !== 'triage')} /></label>
          <label>Khởi tạo Auto<br /><Select style={{ width: 200 }} value={st.initialAuto} onChange={(v) => patch({ initialAuto: v })} options={statusOptions} /></label>
          <label>Đích khi Accept<br /><Select allowClear style={{ width: 200 }} value={st.accept} onChange={(v) => patch({ accept: v })} options={statusOptions} /></label>
          <label>Đích khi Reject/Duplicate<br /><Select allowClear style={{ width: 200 }} value={st.reject} onChange={(v) => patch({ reject: v })} options={statusOptions} /></label>
        </Space>
      </Card>

      <Card title="Xem trước luồng"><FlowPreview rows={st.rows} pairs={st.pairs} allowAny={st.allowAny} /></Card>

      <div><Button type="primary" size="large" loading={saving} onClick={save}>Lưu workflow</Button></div>

      <Modal open={!!replace} title="Chọn trạng thái thay thế" onCancel={() => setReplace(null)} okText="Lưu" cancelText="Hủy" confirmLoading={saving}
        okButtonProps={{ disabled: !replace || replace.removed.some((r) => !replace.map[r.ref]) }} onOk={() => doSave(replace!.map)}>
        <Typography.Paragraph>Các trạng thái sau đang có item. Chọn trạng thái để chuyển toàn bộ item sang (trong một transaction), trạng thái cũ sẽ được lưu trữ.</Typography.Paragraph>
        {replace?.removed.map((r) => (
          <div key={r.ref} style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <b style={{ minWidth: 140 }}>{r.name}</b> ({r.issueCount} item) →
            <Select style={{ flex: 1 }} placeholder="Trạng thái thay thế" value={replace.map[r.ref]} onChange={(v) => setReplace({ ...replace, map: { ...replace.map, [r.ref]: v } })} options={statusOptions} />
          </div>
        ))}
      </Modal>
    </Space>
  );
}

/** Sơ đồ các trạng thái nối bằng mũi tên (SVG, bố trí vòng tròn). */
function FlowPreview({ rows, pairs, allowAny }: { rows: Row[]; pairs: Set<string>; allowAny: boolean }) {
  const W = 760, H = 320, cx = W / 2, cy = H / 2, R = 120;
  const pos = new Map(rows.map((r, i) => { const a = (2 * Math.PI * i) / Math.max(1, rows.length) - Math.PI / 2; return [r.ref, { x: cx + R * 1.9 * Math.cos(a), y: cy + R * Math.sin(a) }] as const; }));
  const edges = [...pairs].map((p) => p.split('->')).filter(([f, t]) => f !== '*' && pos.has(f) && pos.has(t));
  const anyTo = [...pairs].map((p) => p.split('->')).filter(([f, t]) => f === '*' && pos.has(t)).map(([, t]) => t);
  return (
    <div style={{ overflowX: 'auto' }}>
      <svg width={W} height={H} role="img" aria-label="Sơ đồ workflow">
        <defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#8c8c8c" /></marker></defs>
        {edges.map(([f, t], i) => {
          const a = pos.get(f)!, b = pos.get(t)!;
          const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
          const off = 6; // lệch nhẹ để hai chiều không chồng nhau
          const nx = (-dy / len) * off, ny = (dx / len) * off;
          const s = 46 / len;
          return <line key={i} x1={a.x + dx * s + nx} y1={a.y + dy * s + ny} x2={b.x - dx * s + nx} y2={b.y - dy * s + ny} stroke="#8c8c8c" strokeWidth={1.2} markerEnd="url(#arr)" />;
        })}
        {rows.map((r) => {
          const p = pos.get(r.ref)!;
          return (
            <g key={r.ref}>
              <rect x={p.x - 46} y={p.y - 15} width={92} height={30} rx={6} fill={r.color} opacity={r.category === 'triage' ? 0.85 : 1} stroke={r.category === 'triage' ? '#531dab' : 'none'} strokeDasharray={r.category === 'triage' ? '4 2' : undefined} />
              <text x={p.x} y={p.y + 4} textAnchor="middle" fill="#fff" fontSize={12} fontWeight={600}>{(r.name || '…').slice(0, 13)}</text>
            </g>
          );
        })}
      </svg>
      {allowAny && <Typography.Text type="secondary">Đang bật "Cho phép chuyển tự do": mọi trạng thái đều chuyển được sang mọi trạng thái.</Typography.Text>}
      {anyTo.length > 0 && <div className="muted">Từ mọi trạng thái → {anyTo.map((t) => rows.find((r) => r.ref === t)?.name).join(', ')}</div>}
    </div>
  );
}
