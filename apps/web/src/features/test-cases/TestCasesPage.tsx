import { PlusOutlined, SettingOutlined } from '@ant-design/icons';
import { App, Button, Card, Checkbox, Dropdown, Form, Input, Modal, Popconfirm, Progress, Select, Space, Splitter, Tag, Tree, Typography } from 'antd';
import type { DataNode } from 'antd/es/tree';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { TEST_CASE_PRIORITIES, TEST_CASE_STATUSES } from '@ospm/shared';
import { bulkUpdateTestCases, createRequirement, createTestCase, getTestCaseSummary, listRequirements, listTestCaseIds } from '../../api/generated/api';
import { errorMessage } from '../../api/http';
import { useTestCategories } from '../../api/hooks';
import { EmptyState, ErrorState } from '../../components/EmptyState';
import { useAuth, useCan } from '../auth/authStore';
import { ExportButton, ImportButton } from './ImportExport';
import { waitForJob } from './jobs';
import { GridHandle, TestCaseGrid } from './TestCaseGrid';
import { TestCaseDrawer } from './TestCaseDrawer';
import { STATUS_HEX, STATUS_LABEL } from './labels';

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
  const canEdit = useCan(projectKey, 'developer');
  const canDelete = useCan(projectKey, 'tester');
  const { data: categories = [] } = useTestCategories(projectKey);
  const functionId = sp.get('functionId') ?? undefined;
  const epicId = sp.get('epicId') ?? undefined;
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
  const [reqOpen, setReqOpen] = useState<null | 'epic' | 'function'>(null);
  const [hidden, setHidden] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('tc-hidden-cols') ?? '[]'); } catch { return []; } });
  const grid = useRef<GridHandle>(null);

  const tree = useQuery<any>({ queryKey: ['requirements', projectKey], queryFn: () => listRequirements(projectKey) });
  const scope = { functionId, epicId };
  const summary = useQuery<any>({ queryKey: ['tc-summary', projectKey, scope, reload], queryFn: () => getTestCaseSummary(projectKey, scope as any) });

  const selectedFn = useMemo(() => {
    for (const e of tree.data?.epics ?? []) for (const f of e.functions) if (String(f.id) === functionId) return f;
    return (tree.data?.unassigned ?? []).find((f: any) => String(f.id) === functionId);
  }, [tree.data, functionId]);

  const treeData = useMemo<DataNode[]>(() => {
    const match = (s: string) => !treeQ || s.toLowerCase().includes(treeQ.toLowerCase());
    const fnNode = (f: any): DataNode => ({
      key: `f:${f.id}`, isLeaf: true,
      title: (<div style={{ display: 'flex', flexDirection: 'column' }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span>{f.code} · {f.name}</span><span className="muted">{f.counts.total}</span></div><Progress percent={f.progress} size="small" showInfo={false} strokeColor="#52c41a" /></div>),
    });
    const epics = (tree.data?.epics ?? []).map((e: any) => ({ ...e, functions: e.functions.filter((f: any) => match(`${f.code} ${f.name}`) || match(`${e.code} ${e.name}`)) })).filter((e: any) => !treeQ || e.functions.length || match(`${e.code} ${e.name}`));
    const nodes: DataNode[] = epics.map((e: any) => ({ key: `e:${e.id}`, title: <span><b>{e.code}</b> · {e.name} <span className="muted">({e.counts.total})</span></span>, children: e.functions.map(fnNode) }));
    const un = (tree.data?.unassigned ?? []).filter((f: any) => match(`${f.code} ${f.name}`));
    if (un.length) nodes.push({ key: 'unassigned', title: <i>Chưa thuộc epic</i>, children: un.map(fnNode), selectable: false });
    return [{ key: 'all', title: <b>Tất cả test case</b>, children: nodes }];
  }, [tree.data, treeQ]);

  const selectKey = functionId ? `f:${functionId}` : epicId ? `e:${epicId}` : 'all';
  const onSelectNode = (key: string) => {
    const n = new URLSearchParams();
    if (key.startsWith('f:')) n.set('functionId', key.slice(2)); else if (key.startsWith('e:')) n.set('epicId', key.slice(2));
    setSp(n, { replace: true }); setSelected([]); setAllIds(null);
  };

  const refreshAll = useCallback(() => { setReload((r) => r + 1); void qc.invalidateQueries({ queryKey: ['requirements', projectKey] }); }, [qc, projectKey]);
  const effectiveIds = allIds ?? selected;
  const filters = useMemo(() => ({ functionId, epicId, q: q || undefined, status, categoryId, priority }), [functionId, epicId, q, status, categoryId, priority]);

  const bulk = async (set: Record<string, unknown>) => {
    try {
      const r = await bulkUpdateTestCases(projectKey, { ids: effectiveIds.map(String), set: set as any });
      if (r.async) { message.loading({ content: `Đang cập nhật ${r.total} dòng…`, key: 'bulk', duration: 0 }); await waitForJob(r.jobId); message.success({ content: 'Đã cập nhật', key: 'bulk' }); }
      else message.success(`Đã cập nhật ${r.updated} dòng`);
      setSelected([]); setAllIds(null); grid.current?.api()?.deselectAll(); refreshAll();
    } catch (e) { message.error({ content: errorMessage(e), key: 'bulk' }); }
  };

  if (tree.error) return <ErrorState error={tree.error} onRetry={tree.refetch} />;
  const sm = summary.data;
  const fnOptions = (tree.data?.epics ?? []).flatMap((e: any) => e.functions).concat(tree.data?.unassigned ?? []);

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
      <Card size="small" styles={{ body: { padding: 8 } }} style={{ alignSelf: 'start' }} title="Epic / Function"
        extra={canEdit && <Dropdown menu={{ items: [{ key: 'epic', label: 'Thêm epic', onClick: () => setReqOpen('epic') }, { key: 'fn', label: 'Thêm function', onClick: () => setReqOpen('function') }] }}><Button size="small" icon={<PlusOutlined />} /></Dropdown>}>
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
          ) : <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>{epicId ? 'Các function của epic đã chọn' : 'Toàn bộ test case của dự án'}</Typography.Text>}
          {sm && (
            <Space size="large" wrap data-testid="checklist-summary">
              {TEST_CASE_STATUSES.map((s) => <span key={s}><span style={{ color: STATUS_HEX[s], fontWeight: 600 }}>{STATUS_LABEL[s]}</span>: {sm.totals[s === 'not_started' ? 'notStarted' : s]}</span>)}
              <span>Total: <b>{sm.totals.total}</b></span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>Progress <Progress percent={sm.progress} size="small" style={{ width: 160 }} strokeColor="#52c41a" /></span>
            </Space>
          )}
        </Card>

        <Space wrap style={{ marginBottom: 8 }}>
          <Input.Search allowClear placeholder="Tìm mã, tiêu đề, nội dung bước" style={{ width: 260 }} onSearch={setQ} />
          <Select mode="multiple" allowClear placeholder="Status" style={{ minWidth: 130 }} maxTagCount="responsive" value={status} onChange={setStatus} options={TEST_CASE_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))} />
          <Select mode="multiple" allowClear placeholder="Category" style={{ minWidth: 130 }} maxTagCount="responsive" value={categoryId} onChange={setCategoryId} options={categories.map((c) => ({ value: String(c.id), label: c.name }))} />
          <Select mode="multiple" allowClear placeholder="Priority" style={{ minWidth: 120 }} maxTagCount="responsive" value={priority} onChange={setPriority} options={TEST_CASE_PRIORITIES.map((p) => ({ value: p, label: p }))} />
          <div style={{ flex: 1 }} />
          {canEdit && <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>Test case</Button>}
          {canEdit && <ImportButton projectKey={projectKey} />}
          <ExportButton projectKey={projectKey} functionId={functionId} />
          <Dropdown trigger={['click']} dropdownRender={() => (
            <Card size="small"><Space direction="vertical">{ALL_COLS.map(([id, label]) => (
              <Checkbox key={id} checked={!hidden.includes(id)} onChange={(e) => { const n = e.target.checked ? hidden.filter((h) => h !== id) : [...hidden, id]; setHidden(n); localStorage.setItem('tc-hidden-cols', JSON.stringify(n)); }}>{label}</Checkbox>
            ))}</Space></Card>
          )}><Button icon={<SettingOutlined />}>Cột</Button></Dropdown>
        </Space>

        {effectiveIds.length > 0 && canEdit && (
          <Space wrap style={{ marginBottom: 8, padding: 8, background: '#ffe0e9', borderRadius: 6, width: '100%' }}>
            <b>{effectiveIds.length} dòng</b>
            {!allIds && <a onClick={async () => { const r = await listTestCaseIds(projectKey, filters as any); setAllIds(r.ids); }}>Chọn tất cả theo bộ lọc</a>}
            {allIds && <a onClick={() => setAllIds(null)}>Bỏ chọn tất cả</a>}
            <Select size="small" placeholder="Đổi status" style={{ width: 130 }} value={undefined} onChange={(v) => bulk({ status: v })} options={TEST_CASE_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))} />
            <Select size="small" placeholder="Đổi priority" style={{ width: 130 }} value={undefined} onChange={(v) => bulk({ priority: v })} options={TEST_CASE_PRIORITIES.map((p) => ({ value: p, label: p }))} />
            <Select size="small" placeholder="Đổi category" style={{ width: 140 }} value={undefined} onChange={(v) => bulk({ categoryId: v })} options={categories.map((c) => ({ value: c.id, label: c.name }))} />
            <Select size="small" placeholder="Chuyển function" showSearch optionFilterProp="label" style={{ width: 180 }} value={undefined} onChange={(v) => bulk({ functionId: v })} options={fnOptions.map((f: any) => ({ value: f.id, label: `${f.code} · ${f.name}` }))} />
            {canDelete && <Popconfirm title={`Xóa ${effectiveIds.length} test case?`} okButtonProps={{ danger: true }} onConfirm={() => bulk({ deleted: true })}><Button size="small" danger>Xóa</Button></Popconfirm>}
          </Space>
        )}

        {tree.data && !fnOptions.length && !tree.data.epics.length ? <Card><EmptyState title="Chưa có epic/function. Thêm thủ công hoặc import Excel." /></Card> : (
          // rowModelType không đổi được sau khi khởi tạo: Client-Side khi xem một function, Infinite khi xem epic/dự án
          <TestCaseGrid key={functionId ? 'client' : 'infinite'} ref={grid} projectKey={projectKey} filters={filters} categories={categories} canEdit={canEdit} reloadToken={reload} hiddenCols={hidden}
            onOpen={setOpenId} onSelection={(ids) => { setSelected(ids); setAllIds(null); }} me={me} />
        )}
      </div>
      </Splitter.Panel>
      </Splitter>

      <TestCaseDrawer projectKey={projectKey} id={openId} onClose={() => setOpenId(null)} onSaved={(row) => { if (row) grid.current?.updateRow(row); else refreshAll(); void qc.invalidateQueries({ queryKey: ['tc-summary'] }); }} />
      <CreateTestCaseModal open={createOpen} projectKey={projectKey} functions={fnOptions} defaultFunctionId={functionId} onClose={() => setCreateOpen(false)} onCreated={(row) => { setCreateOpen(false); refreshAll(); setOpenId(row.id); }} />
      <RequirementModal kind={reqOpen} projectKey={projectKey} epics={tree.data?.epics ?? []} onClose={() => setReqOpen(null)} onCreated={() => { setReqOpen(null); refreshAll(); }} />
    </div>
  );
}

function CreateTestCaseModal({ open, projectKey, functions, defaultFunctionId, onClose, onCreated }: { open: boolean; projectKey: string; functions: any[]; defaultFunctionId?: string; onClose: () => void; onCreated: (row: any) => void }) {
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const { data: categories = [] } = useTestCategories(projectKey);
  return (
    <Modal title="Thêm test case" open={open} onCancel={onClose} onOk={() => form.submit()} okText="Tạo" cancelText="Hủy" destroyOnClose afterOpenChange={(o) => o && form.setFieldsValue({ functionId: defaultFunctionId ? Number(defaultFunctionId) : undefined, priority: 'medium' })}>
      <Form form={form} layout="vertical" onFinish={async (v) => {
        try { onCreated(await createTestCase(projectKey, { functionId: v.functionId, title: v.title, priority: v.priority, categoryId: v.categoryId })); } catch (e) { message.error(errorMessage(e)); }
      }}>
        <Form.Item name="functionId" label="Function" rules={[{ required: true, message: 'Chọn function' }]}><Select showSearch optionFilterProp="label" options={functions.map((f) => ({ value: f.id, label: `${f.code} · ${f.name}` }))} /></Form.Item>
        <Form.Item name="title" label="Checklist Item" rules={[{ required: true }]}><Input autoFocus /></Form.Item>
        <Form.Item name="priority" label="Priority"><Select options={TEST_CASE_PRIORITIES.map((p) => ({ value: p, label: p }))} /></Form.Item>
        <Form.Item name="categoryId" label="Category"><Select allowClear options={categories.map((c) => ({ value: c.id, label: c.name }))} /></Form.Item>
      </Form>
    </Modal>
  );
}

function RequirementModal({ kind, projectKey, epics, onClose, onCreated }: { kind: null | 'epic' | 'function'; projectKey: string; epics: any[]; onClose: () => void; onCreated: () => void }) {
  const [form] = Form.useForm();
  const { message } = App.useApp();
  return (
    <Modal title={kind === 'epic' ? 'Thêm epic' : 'Thêm function'} open={!!kind} onCancel={onClose} onOk={() => form.submit()} okText="Tạo" cancelText="Hủy" destroyOnClose>
      <Form form={form} layout="vertical" onFinish={async (v) => {
        try { await createRequirement(projectKey, { kind: kind!, code: v.code, name: v.name, traceRef: v.traceRef, sources: v.sources ? String(v.sources).split('\n').filter(Boolean) : undefined, epicIds: v.epicIds }); onCreated(); } catch (e) { message.error(errorMessage(e)); }
      }}>
        <Form.Item name="code" label={kind === 'epic' ? 'Mã epic (NDS-E-00946)' : 'Mã function (NDS-U-00796)'} rules={[{ required: true }]}><Input autoFocus /></Form.Item>
        <Form.Item name="name" label="Tên" rules={[{ required: true }]}><Input /></Form.Item>
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
