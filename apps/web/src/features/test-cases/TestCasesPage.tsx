import { PlusOutlined, SettingOutlined } from '@ant-design/icons';
import { App, Button, Card, Checkbox, Dropdown, Form, Input, Modal, Popconfirm, Progress, Segmented, Select, Space, Splitter, Tag, Tooltip, Tree, Typography } from 'antd';
import type { DataNode } from 'antd/es/tree';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { TEST_CASE_PRIORITIES, TEST_CASE_STATUSES } from '@ospm/shared';
import { bulkUpdateTestCases, createRequirement, getTestCaseSummary, listRequirements, listTestCaseIds } from '../../api/generated/api';
import { errorMessage, http } from '../../api/http';
import { useTestCategories } from '../../api/hooks';
import { EmptyState, ErrorState } from '../../components/EmptyState';
import { useAuth, usePermission } from '../auth/authStore';
import { ExportButton, ImportButton } from './ImportExport';
import { waitForJob } from './jobs';
import { GridHandle, TestCaseGrid } from './TestCaseGrid';
import { TestCaseDrawer } from './TestCaseDrawer';
import { STATUS_HEX, STATUS_LABEL } from './labels';
import { fmtNumber } from '../../lib/number';
import { useProjectStructure } from '../project-structure';

const ALL_COLS = [['priority', 'Priority'], ['category', 'Category'], ['preconditions', 'Pre-conditions'], ['stepCount', 'Số bước'], ['status', 'Status'], ['bugs', 'Link Bug'], ['notes', 'Notes'], ['updatedAt', 'Cập nhật']] as const;
const TREE_WIDTH_KEY = 'tc-tree-width-percent';

function savedTreeWidth() {
  try {
    const width = Number(localStorage.getItem(TREE_WIDTH_KEY) ?? 25);
    return width === 0 || (Number.isFinite(width) && width >= 15 && width <= 50) ? width : 25;
  } catch { return 25; }
}

export default function TestCasesPage() {
  const { projectKey = '' } = useParams();
  const [sp, setSp] = useSearchParams();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const me = useAuth((s) => s.user);
  const canEdit = usePermission(projectKey, 'testcase.edit');
  const canCreate = usePermission(projectKey, 'testcase.create');
  const canImport = usePermission(projectKey, 'testcase.import');
  const canExport = usePermission(projectKey, 'testcase.export');
  const canCreateRequirement = usePermission(projectKey, 'requirement.create');
  const canDelete = usePermission(projectKey, 'testcase.delete');
  const { data: categories = [] } = useTestCategories(projectKey);
  const functionId = sp.get('functionId') ?? undefined;
  const epicId = sp.get('epicId') ?? undefined;
  const moduleId = sp.get('moduleId') ?? undefined;
  const [treeMode, setTreeMode] = useState<'module' | 'epic'>(() => sp.has('moduleId') ? 'module' : 'epic');
  const structure = useProjectStructure(projectKey);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<string[]>([]);
  const [categoryId, setCategoryId] = useState<string[]>([]);
  const [priority, setPriority] = useState<string[]>([]);
  const [treeQ, setTreeQ] = useState('');
  const [initialTreeWidth] = useState(savedTreeWidth);
  const [reload, setReload] = useState(0);
  const [openId, setOpenId] = useState<number | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [allIds, setAllIds] = useState<number[] | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [reqOpen, setReqOpen] = useState<null | 'epic' | 'function' | 'module'>(null);
  const [hidden, setHidden] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('tc-hidden-cols') ?? '[]'); } catch { return []; } });
  const grid = useRef<GridHandle>(null);

  const tree = useQuery<any>({ queryKey: ['requirements', projectKey], queryFn: () => listRequirements(projectKey) });
  const scope = { functionId, epicId, moduleId };
  const summary = useQuery<any>({ queryKey: ['tc-summary', projectKey, scope, reload], queryFn: () => getTestCaseSummary(projectKey, scope as any) });

  const selectedFn = useMemo(() => {
    for (const e of tree.data?.epics ?? []) for (const f of e.functions) if (String(f.id) === functionId) return f;
    return (tree.data?.unassigned ?? []).find((f: any) => String(f.id) === functionId);
  }, [tree.data, functionId]);

  const treeData = useMemo<DataNode[]>(() => {
    const match = (s: string) => !treeQ || s.toLowerCase().includes(treeQ.toLowerCase());
    const fnNode = (f: any): DataNode => ({
      key: `f:${f.id}`, isLeaf: true,
      title: (<div style={{ display: 'flex', flexDirection: 'column' }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span>{f.code} · {f.name}</span><span className="muted" style={{ whiteSpace: 'nowrap' }}>{fmtNumber(f.counts.total)} TC</span></div><Tooltip title={`Đã test: ${fmtNumber(f.counts.passed + f.counts.failed)}/${fmtNumber(f.counts.total)} TC. (Passed + Failed) / Tổng TC.`}><Progress aria-label={`Đã test ${f.code}`} percent={f.progress} size="small" status="normal" format={(percent) => `${fmtNumber(percent)}%`} strokeColor="#52c41a" /></Tooltip></div>),
    });
    const epics = (tree.data?.epics ?? []).map((e: any) => ({ ...e, functions: e.functions.filter((f: any) => match(`${f.code} ${f.name}`) || match(`${e.code} ${e.name}`)) })).filter((e: any) => !treeQ || e.functions.length || match(`${e.code} ${e.name}`));
    const nodes: DataNode[] = epics.map((e: any) => ({ key: `e:${e.id}`, title: <span><b>{e.code}</b> · {e.name} <span className="muted">({fmtNumber(e.counts.total)})</span></span>, children: e.functions.map(fnNode) }));
    const un = (tree.data?.unassigned ?? []).filter((f: any) => match(`${f.code} ${f.name}`));
    if (un.length) nodes.push({ key: 'unassigned', title: <i>Chưa thuộc epic</i>, children: un.map(fnNode), selectable: false });
    if (treeMode === 'module') {
      const allFunctions: any[] = [...new Map<string, any>((tree.data?.epics ?? []).flatMap((epic: any) => epic.functions).concat(tree.data?.unassigned ?? []).map((fn: any) => [String(fn.id), fn] as [string, any])).values()];
      const modules: DataNode[] = (structure.data?.modules ?? []).filter((module) => !treeQ || match(`${module.code} ${module.name}`) || allFunctions.some((fn) => Number(fn.moduleId) === module.id && match(`${fn.code} ${fn.name}`))).map((module) => {
        const functions = allFunctions.filter((fn) => Number(fn.moduleId) === module.id && (match(`${module.code} ${module.name}`) || match(`${fn.code} ${fn.name}`)));
        return { key: `m:${module.id}`, title: <span><b>{module.code}</b> · {module.name} <span className="muted">({fmtNumber(functions.reduce((total, fn) => total + fn.counts.total, 0))})</span></span>, children: functions.map(fnNode) };
      });
      const unassigned = allFunctions.filter((fn) => fn.moduleId == null && match(`${fn.code} ${fn.name}`));
      if (unassigned.length) modules.push({ key: 'no-module', title: <i>Chưa phân Module</i>, selectable: false, children: unassigned.map(fnNode) });
      return [{ key: 'all', title: <b>Tất cả test case</b>, children: modules }];
    }
    return [{ key: 'all', title: <b>Tất cả test case</b>, children: nodes }];
  }, [tree.data, treeQ, treeMode, structure.data]);

  const selectKey = functionId ? `f:${functionId}` : epicId ? `e:${epicId}` : moduleId ? `m:${moduleId}` : 'all';
  const onSelectNode = (key: string) => {
    const n = new URLSearchParams();
    if (key.startsWith('f:')) n.set('functionId', key.slice(2)); else if (key.startsWith('e:')) n.set('epicId', key.slice(2)); else if (key.startsWith('m:')) n.set('moduleId', key.slice(2));
    setSp(n, { replace: true }); setSelected([]); setAllIds(null);
  };

  const refreshAll = useCallback(() => { setReload((r) => r + 1); void qc.invalidateQueries({ queryKey: ['requirements', projectKey] }); void qc.invalidateQueries({ queryKey: ['project-structure'] }); void qc.invalidateQueries({ queryKey: ['project-structure-management'] }); void qc.invalidateQueries({ queryKey: ['backlog', projectKey] }); }, [qc, projectKey]);
  const refreshCounts = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['requirements', projectKey] });
    void qc.invalidateQueries({ queryKey: ['tc-summary', projectKey] });
  }, [qc, projectKey]);
  const effectiveIds = allIds ?? selected;
  const filters = useMemo(() => ({ functionId, epicId, moduleId, q: q || undefined, status, categoryId, priority }), [functionId, epicId, moduleId, q, status, categoryId, priority]);

  const bulk = async (set: Record<string, unknown>) => {
    if (set.deleted ? !canDelete : !canEdit) return;
    try {
      const r = await bulkUpdateTestCases(projectKey, { ids: effectiveIds.map(String), set: set as any });
      if (r.async) { message.loading({ content: `Đang cập nhật ${fmtNumber(r.total)} dòng…`, key: 'bulk', duration: 0 }); await waitForJob(r.jobId); message.success({ content: 'Đã cập nhật', key: 'bulk' }); }
      else message.success(`Đã cập nhật ${fmtNumber(r.updated)} dòng`);
      setSelected([]); setAllIds(null); grid.current?.api()?.deselectAll(); refreshAll();
    } catch (e) { message.error({ content: errorMessage(e), key: 'bulk' }); }
  };

  if (tree.error) return <ErrorState error={tree.error} onRetry={tree.refetch} />;
  const sm = summary.data;
  const fnOptions = [...new Map<string, any>((tree.data?.epics ?? []).flatMap((e: any) => e.functions).concat(tree.data?.unassigned ?? []).map((fn: any) => [String(fn.id), fn] as [string, any])).values()];

  return (
    <div className="page">
      <Splitter style={{ height: 'auto' }} onResizeEnd={(sizes) => {
        const total = sizes.reduce((sum, size) => sum + size, 0);
        if (total > 0) {
          const percent = sizes[0] === 0 ? 0 : Math.max(15, Math.min(50, sizes[0] / total * 100));
          try { localStorage.setItem(TREE_WIDTH_KEY, String(percent)); } catch { /* Layout still works when storage is unavailable. */ }
        }
      }}>
      <Splitter.Panel defaultSize={`${initialTreeWidth}%`} min="15%" max="50%" collapsible style={{ paddingRight: 8, overflow: 'hidden' }}>
      <Card size="small" styles={{ body: { padding: 8 } }} style={{ alignSelf: 'start' }} title={treeMode === 'module' ? 'Module / Function' : 'Epic / Function'}
        extra={canCreateRequirement && <Dropdown menu={{ items: [{ key: 'epic', label: 'Thêm epic', onClick: () => setReqOpen('epic') }, { key: 'module', label: 'Thêm Module', onClick: () => setReqOpen('module') }, { key: 'fn', label: 'Thêm function', onClick: () => setReqOpen('function') }] }}><Button aria-label="Tạo nhanh cấu trúc" size="small" icon={<PlusOutlined />} /></Dropdown>}>
        <Segmented aria-label="Nhóm test case" block size="small" style={{ marginBottom: 8 }} value={treeMode} onChange={(value) => setTreeMode(value as 'module' | 'epic')} options={[{ value: 'epic', label: 'Theo Epic' }, { value: 'module', label: 'Theo Module' }]} />
        <Input.Search size="small" allowClear placeholder="Tìm mã/tên function" style={{ marginBottom: 8 }} onChange={(e) => setTreeQ(e.target.value)} />
        <Tree virtual height={Math.max(300, window.innerHeight - 330)} treeData={treeData} selectedKeys={[selectKey]} defaultExpandAll key={`${treeQ}-${tree.data ? 'ready' : 'loading'}`} blockNode
          onSelect={(keys) => keys[0] && onSelectNode(String(keys[0]))} />
        {tree.isLoading && <div className="muted">Đang tải…</div>}
      </Card>
      </Splitter.Panel>

      <Splitter.Panel min="50%" style={{ paddingLeft: 8, overflow: 'hidden' }}>
      <div style={{ minWidth: 0 }}>
        <Card size="small" style={{ marginBottom: 12 }}>
          {selectedFn ? (
            <div style={{ marginBottom: 8 }}>
              <Typography.Text strong>{selectedFn.code}</Typography.Text> · {selectedFn.name}
              {selectedFn.traceRef && <Tag style={{ marginLeft: 8 }}>{selectedFn.traceRef}</Tag>}
              {selectedFn.sources?.map((s: string) => <a key={s} href={/^https?:/.test(s) ? s : undefined} target="_blank" rel="noreferrer" style={{ marginLeft: 8 }}>{s}</a>)}
            </div>
          ) : epicId ? <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>Các function của epic đã chọn</Typography.Text> : null}
          {sm && (
            <Space size="large" wrap data-testid="checklist-summary">
              {TEST_CASE_STATUSES.map((s) => <span key={s}><span style={{ color: STATUS_HEX[s], fontWeight: 600 }}>{STATUS_LABEL[s]}</span>: {fmtNumber(sm.totals[s === 'not_started' ? 'notStarted' : s])}</span>)}
              <span>Total: <b>{fmtNumber(sm.totals.total)}</b></span>
              <Tooltip title={`Đã test: ${fmtNumber(sm.totals.passed + sm.totals.failed)}/${fmtNumber(sm.totals.total)} TC. Chỉ tính Passed và Failed; Not Started, Blocked và N/A chưa tính là đã test.`}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>Đã test <Progress aria-label="Tiến độ test" percent={sm.progress} status="normal" format={(percent) => `${fmtNumber(percent)}%`} size="small" style={{ width: 160 }} strokeColor="#52c41a" /></span></Tooltip>
            </Space>
          )}
        </Card>

        <Space wrap style={{ marginBottom: 8 }}>
          <Select aria-label="Lọc Module test case" allowClear placeholder="Module" style={{ width: 170 }} showSearch optionFilterProp="label" value={moduleId ? Number(moduleId) : undefined}
            onChange={(id) => { const next = new URLSearchParams(sp); next.delete('functionId'); next.delete('epicId'); if (id) next.set('moduleId', String(id)); else next.delete('moduleId'); setSp(next, { replace: true }); setSelected([]); setAllIds(null); setTreeMode('module'); }} options={(structure.data?.modules ?? []).map((module) => ({ value: module.id, label: `${module.code} · ${module.name}` }))} />
          <Input.Search allowClear placeholder="Tìm mã, tiêu đề, nội dung bước" style={{ width: 260 }} onSearch={setQ} />
          <Select mode="multiple" allowClear placeholder="Status" style={{ minWidth: 130 }} maxTagCount="responsive" value={status} onChange={setStatus} options={TEST_CASE_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))} />
          <Select mode="multiple" allowClear placeholder="Category" style={{ minWidth: 130 }} maxTagCount="responsive" value={categoryId} onChange={setCategoryId} options={categories.map((c) => ({ value: String(c.id), label: c.name }))} />
          <Select mode="multiple" allowClear placeholder="Priority" style={{ minWidth: 120 }} maxTagCount="responsive" value={priority} onChange={setPriority} options={TEST_CASE_PRIORITIES.map((p) => ({ value: p, label: p }))} />
          <div style={{ flex: 1 }} />
          {canCreate && <Button aria-label="Thêm test case" type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>Test case</Button>}
          {canImport && <ImportButton projectKey={projectKey} />}
          {canExport && <ExportButton projectKey={projectKey} functionId={functionId} epicId={epicId} moduleId={moduleId} />}
          <Dropdown trigger={['click']} dropdownRender={() => (
            <Card size="small"><Space direction="vertical">{ALL_COLS.map(([id, label]) => (
              <Checkbox key={id} checked={!hidden.includes(id)} onChange={(e) => { const n = e.target.checked ? hidden.filter((h) => h !== id) : [...hidden, id]; setHidden(n); localStorage.setItem('tc-hidden-cols', JSON.stringify(n)); }}>{label}</Checkbox>
            ))}</Space></Card>
          )}><Button icon={<SettingOutlined />}>Cột</Button></Dropdown>
        </Space>

        {effectiveIds.length > 0 && (canEdit || canDelete) && (
          <Space wrap style={{ marginBottom: 8, padding: 8, background: '#ffe0e9', borderRadius: 6, width: '100%' }}>
            <b>{fmtNumber(effectiveIds.length)} dòng</b>
            {!allIds && <a onClick={async () => { const r = await listTestCaseIds(projectKey, filters as any); setAllIds(r.ids); }}>Chọn tất cả theo bộ lọc</a>}
            {allIds && <a onClick={() => setAllIds(null)}>Bỏ chọn tất cả</a>}
            <Select disabled={!canEdit} size="small" placeholder="Đổi status" style={{ width: 130 }} value={undefined} onChange={(v) => bulk({ status: v })} options={TEST_CASE_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))} />
            <Select disabled={!canEdit} size="small" placeholder="Đổi priority" style={{ width: 130 }} value={undefined} onChange={(v) => bulk({ priority: v })} options={TEST_CASE_PRIORITIES.map((p) => ({ value: p, label: p }))} />
            <Select disabled={!canEdit} size="small" placeholder="Đổi category" style={{ width: 140 }} value={undefined} onChange={(v) => bulk({ categoryId: v })} options={categories.map((c) => ({ value: c.id, label: c.name }))} />
            <Select disabled={!canEdit} size="small" placeholder="Chuyển function" showSearch optionFilterProp="label" style={{ width: 180 }} value={undefined} onChange={(v) => bulk({ functionId: v })} options={fnOptions.map((f: any) => ({ value: f.id, label: `${f.code} · ${f.name}` }))} />
            {canDelete && <Popconfirm title={`Xóa ${fmtNumber(effectiveIds.length)} test case?`} okButtonProps={{ danger: true }} onConfirm={() => bulk({ deleted: true })}><Button size="small" danger>Xóa</Button></Popconfirm>}
          </Space>
        )}

        {tree.data && !fnOptions.length && !tree.data.epics.length ? <Card><EmptyState title="Chưa có epic/function. Thêm thủ công hoặc import Excel." /></Card> : (
          // rowModelType không đổi được sau khi khởi tạo: Client-Side khi xem một function, Infinite khi xem epic/dự án
          <TestCaseGrid key={functionId ? 'client' : 'infinite'} ref={grid} projectKey={projectKey} filters={filters} categories={categories} canEdit={canEdit} reloadToken={reload} hiddenCols={hidden}
            onOpen={setOpenId} onSelection={(ids) => { setSelected(ids); setAllIds(null); }} onSaved={refreshCounts} me={me} />
        )}
      </div>
      </Splitter.Panel>
      </Splitter>

      <TestCaseDrawer projectKey={projectKey} id={createOpen ? null : openId} creating={createOpen && canCreate} functions={moduleId ? fnOptions.filter((fn) => String(fn.moduleId) === moduleId) : fnOptions} defaultFunctionId={functionId} onClose={() => { setOpenId(null); setCreateOpen(false); }} onSaved={(row) => { if (row) grid.current?.updateRow(row); else refreshAll(); refreshCounts(); }} onCreated={() => refreshAll()} />
      <RequirementModal kind={canCreateRequirement ? reqOpen : null} projectKey={projectKey} epics={tree.data?.epics ?? []} defaultModuleId={moduleId} onClose={() => setReqOpen(null)} onCreated={() => { setReqOpen(null); refreshAll(); }} />
    </div>
  );
}

function RequirementModal({ kind, projectKey, epics, defaultModuleId, onClose, onCreated }: { kind: null | 'epic' | 'function' | 'module'; projectKey: string; epics: any[]; defaultModuleId?: string; onClose: () => void; onCreated: () => void }) {
  const canCreate = usePermission(projectKey, 'requirement.create');
  const [form] = Form.useForm();
  const [initialized, setInitialized] = useState(false);
  const { message } = App.useApp();
  const { data: structure } = useProjectStructure(kind ? projectKey : undefined);
  return (
    <Modal title={kind === 'epic' ? 'Thêm epic' : kind === 'module' ? 'Thêm Module' : 'Thêm function'} open={!!kind} onCancel={onClose} onOk={() => form.submit()} okButtonProps={{ disabled: !initialized }} okText="Tạo" cancelText="Hủy" destroyOnClose afterOpenChange={(open) => { if (open) { form.resetFields(); if (kind === 'function' && defaultModuleId) form.setFieldsValue({ moduleId: Number(defaultModuleId) }); } setInitialized(open); }}>
      <Form form={form} layout="vertical" disabled={!initialized} onFinish={async (v) => {
        if (!canCreate || !kind) return;
        try {
          if (kind === 'module') await http.post(`/api/v1/projects/${projectKey}/modules`, { code: v.code, name: v.name });
          else await createRequirement(projectKey, { kind, code: v.code, name: v.name, traceRef: v.traceRef, sources: v.sources ? String(v.sources).split('\n').filter(Boolean) : undefined, epicIds: v.epicIds, moduleId: kind === 'function' ? v.moduleId ?? null : undefined, moduleIds: kind === 'epic' ? v.moduleIds ?? [] : undefined, functionIds: kind === 'epic' ? v.functionIds ?? [] : undefined } as any);
          onCreated();
        } catch (e) { message.error(errorMessage(e)); }
      }}>
        <Form.Item name="code" label={kind === 'epic' ? 'Mã epic (NDS-E-00946)' : kind === 'module' ? 'Mã Module' : 'Mã function (NDS-U-00796)'} rules={[{ required: true }]}><Input autoFocus /></Form.Item>
        <Form.Item name="name" label="Tên" rules={[{ required: true }]}><Input /></Form.Item>
        {kind === 'function' && <Form.Item name="moduleId" label="Module"><Select allowClear showSearch optionFilterProp="label" placeholder="Chưa phân Module" options={(structure?.modules ?? []).map((module) => ({ value: module.id, label: `${module.code} · ${module.name}` }))} /></Form.Item>}
        {kind === 'epic' && <>
          <Form.Item name="moduleIds" label="Module liên quan"><Select mode="multiple" showSearch optionFilterProp="label" options={(structure?.modules ?? []).map((module) => ({ value: module.id, label: `${module.code} · ${module.name}` }))} /></Form.Item>
          <Form.Item name="functionIds" label="Function liên quan"><Select mode="multiple" showSearch optionFilterProp="label" options={(structure?.functions ?? []).map((fn) => ({ value: fn.id, label: `${fn.code} · ${fn.name}` }))} /></Form.Item>
        </>}
        {kind === 'function' && (
          <>
            <Form.Item name="traceRef" label="Trace ref"><Input placeholder="UC 48, BA_MENU_TRACEABILITY Row 48/69" /></Form.Item>
            <Form.Item name="sources" label="Tài liệu BA (mỗi dòng một đường dẫn/URL)"><Input.TextArea rows={3} /></Form.Item>
            <Form.Item name="epicIds" label="Thuộc epic"><Select mode="multiple" options={epics.map((e) => ({ value: e.id, label: `${e.code} · ${e.name}` }))} /></Form.Item>
          </>
        )}
      </Form>
    </Modal>
  );
}
