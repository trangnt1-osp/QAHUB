import { DeleteOutlined, HolderOutlined, PlusOutlined } from '@ant-design/icons';
import { DndContext, DragEndEvent, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { App, Button, Collapse, Drawer, Form, Input, List, Select, Space, Tag, Typography } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { TEST_CASE_PRIORITIES, TEST_CASE_STATUSES } from '@ospm/shared';
import { getTestCase, linkTestCaseBug, unlinkTestCaseBug, updateTestCase } from '../../api/generated/api';
import { errorCode, errorMessage } from '../../api/http';
import { useTestCategories } from '../../api/hooks';
import { fmtDateTime } from '../../lib/date';
import { fmtNumber } from '../../lib/number';
import { usePermission } from '../auth/authStore';
import { STATUS_COLOR, STATUS_LABEL } from './labels';

interface Step { id: string; action: string; expected: string }

function StepRow({ step, index, onChange, onRemove, disabled }: { step: Step; index: number; onChange: (s: Step) => void; onRemove: () => void; disabled: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: step.id, disabled });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, display: 'grid', gridTemplateColumns: '24px 28px 1fr 1fr 28px', gap: 8, alignItems: 'start', marginBottom: 8, background: '#fff' }}>
      <span {...attributes} {...listeners} style={{ cursor: disabled ? 'default' : 'grab', color: '#bfbfbf', paddingTop: 6 }}><HolderOutlined /></span>
      <span style={{ paddingTop: 5 }}>{fmtNumber(index + 1)}.</span>
      <Input.TextArea autoSize={{ minRows: 1, maxRows: 5 }} placeholder="Bước thực hiện" value={step.action} disabled={disabled} onChange={(e) => onChange({ ...step, action: e.target.value })} />
      <Input.TextArea autoSize={{ minRows: 1, maxRows: 5 }} placeholder="Expected" value={step.expected} disabled={disabled} onChange={(e) => onChange({ ...step, expected: e.target.value })} />
      <Button type="text" danger icon={<DeleteOutlined />} disabled={disabled} onClick={onRemove} />
    </div>
  );
}

/** Drawer chi tiết test case: trình sửa từng cặp Bước – Expected, bug liên kết, lịch sử phiên bản. */
interface TestCaseDrawerProps { projectKey: string; id: number | null; onClose: () => void; onSaved: (row: any) => void }

export function TestCaseDrawer(props: TestCaseDrawerProps) {
  const canView = usePermission(props.projectKey, 'testcase.view');
  return canView ? <AuthorizedTestCaseDrawer {...props} /> : null;
}

function AuthorizedTestCaseDrawer({ projectKey, id, onClose, onSaved }: TestCaseDrawerProps) {
  const { data, refetch } = useQuery<any>({ queryKey: ['test-case', id], queryFn: () => getTestCase(String(id)), enabled: !!id });
  const { data: categories = [] } = useTestCategories(projectKey);
  const canEdit = usePermission(projectKey, 'testcase.edit');
  const canLinkBug = usePermission(projectKey, 'testcase.bug.link');
  const canCreateBug = usePermission(projectKey, 'issue.create');
  const [form] = Form.useForm();
  const [steps, setSteps] = useState<Step[]>([]);
  const [saving, setSaving] = useState(false);
  const [bugKey, setBugKey] = useState('');
  const { message } = App.useApp();
  const qc = useQueryClient();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => {
    if (!data) return;
    form.setFieldsValue({ title: data.title, preconditions: data.preconditions, priority: data.priority, status: data.status, categoryId: data.categoryId, notes: data.notes, automationTag: data.automationTag });
    setSteps((data.steps ?? []).map((s: any) => ({ id: s.id, action: s.action, expected: s.expected })));
  }, [data, form]);

  const save = async () => {
    if (!canEdit) return;
    const v = await form.validateFields();
    setSaving(true);
    try {
      const updated = await updateTestCase(String(id), {
        version: data.version, title: v.title, preconditions: v.preconditions ?? null, priority: v.priority, status: v.status, categoryId: v.categoryId ?? null, notes: v.notes ?? null,
        automationTag: v.automationTag ?? null, steps: steps.map((s) => ({ id: s.id, action: s.action, expected: s.expected })),
      } as any);
      message.success('Đã lưu'); onSaved(updated); await refetch(); void qc.invalidateQueries({ queryKey: ['tc-summary'] });
    } catch (e) {
      if (errorCode(e) === 'VERSION_CONFLICT') {
        const who = (e as any).response?.data?.details?.updatedBy?.displayName;
        message.warning(who ? `Test case vừa được ${who} sửa trước đó. Đã tải lại dữ liệu mới.` : 'Test case vừa được người khác sửa. Đã tải lại dữ liệu mới.');
        await refetch();
      } else message.error(errorMessage(e));
    } finally { setSaving(false); }
  };

  return (
    <Drawer open={!!id} onClose={onClose} width="min(900px, 94vw)" destroyOnClose title={data ? `${data.code}` : 'Test case'}
      extra={canEdit && <Button type="primary" onClick={save} loading={saving}>Lưu</Button>}>
      {data && (
        <Form form={form} layout="vertical" disabled={!canEdit}>
          <Form.Item name="title" label="Checklist Item" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="preconditions" label="Pre-conditions"><Input.TextArea autoSize={{ minRows: 2, maxRows: 8 }} /></Form.Item>
          <div style={{ fontWeight: 500, marginBottom: 8 }}>Các bước &amp; kết quả mong đợi</div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e: DragEndEvent) => {
            if (!canEdit || !e.over || e.active.id === e.over.id) return;
            setSteps((s) => arrayMove(s, s.findIndex((x) => x.id === e.active.id), s.findIndex((x) => x.id === e.over!.id)));
          }}>
            <SortableContext items={steps.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              {steps.map((s, i) => <StepRow key={s.id} step={s} index={i} disabled={!canEdit} onChange={(n) => setSteps((a) => a.map((x) => (x.id === s.id ? n : x)))} onRemove={() => setSteps((a) => a.filter((x) => x.id !== s.id))} />)}
            </SortableContext>
          </DndContext>
          {canEdit && <Button icon={<PlusOutlined />} onClick={() => setSteps((a) => [...a, { id: crypto.randomUUID(), action: '', expected: '' }])} style={{ marginBottom: 16 }}>Thêm bước</Button>}
          <Space size="large" wrap style={{ display: 'flex' }}>
            <Form.Item name="priority" label="Priority"><Select style={{ width: 140 }} options={TEST_CASE_PRIORITIES.map((p) => ({ value: p, label: p }))} /></Form.Item>
            <Form.Item name="categoryId" label="Category"><Select allowClear style={{ width: 180 }} options={categories.map((c) => ({ value: c.id, label: c.name }))} /></Form.Item>
            <Form.Item name="status" label="Status"><Select style={{ width: 160 }} options={TEST_CASE_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))} /></Form.Item>
            <Form.Item name="automationTag" label="Tag automation"><Input style={{ width: 240 }} placeholder="@CL_NDS-U-00796-020" /></Form.Item>
          </Space>
          <Form.Item name="notes" label="Notes"><Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} /></Form.Item>
        </Form>
      )}
      {data && (
        <>
          <Typography.Title level={5}>Bug liên kết</Typography.Title>
          <List size="small" locale={{ emptyText: 'Chưa có bug liên kết' }} dataSource={data.bugs} renderItem={(b: any) => (
            <List.Item actions={canLinkBug ? [<a key="u" onClick={async () => { if (!canLinkBug) return; await unlinkTestCaseBug(String(id), { issueKey: b.key } as any); await refetch(); onSaved(null); }}>Gỡ</a>] : []}>
              <Space><Link to={`/browse/${b.key}`}>{b.key}</Link>{b.title}<Tag color={b.status.color}>{b.status.name}</Tag></Space>
            </List.Item>
          )} />
          {canLinkBug && (
            <Space style={{ marginTop: 8 }}>
              <Input placeholder="Mã bug (ELMS-1885)" value={bugKey} onChange={(e) => setBugKey(e.target.value.toUpperCase())} style={{ width: 180 }} />
              <Button disabled={!bugKey} onClick={async () => { if (!canLinkBug) return; try { await linkTestCaseBug(String(id), { issueKey: bugKey }); setBugKey(''); await refetch(); onSaved(null); } catch (e) { message.error(errorMessage(e)); } }}>Gắn bug</Button>
              <Button danger disabled={!canCreateBug || !canEdit} onClick={async () => { if (!canLinkBug || !canCreateBug || !canEdit) return; try { const r = await linkTestCaseBug(String(id), { createBug: true }); message.success(`Đã tạo bug ${r.key}`); await refetch(); onSaved(null); } catch (e) { message.error(errorMessage(e)); } }}>Tạo bug từ test case fail</Button>
            </Space>
          )}
          <Collapse ghost style={{ marginTop: 16 }} items={[{ key: 'v', label: `Lịch sử phiên bản (${fmtNumber(data.versions.length)})`, children: (
            <List size="small" dataSource={data.versions} renderItem={(v: any) => (
              <List.Item><Space><Tag>v{v.version}</Tag><span>{fmtDateTime(v.changedAt)}</span><span className="muted">{v.changedBy?.displayName ?? '—'}</span><Tag color={STATUS_COLOR[v.snapshot.status]}>{STATUS_LABEL[v.snapshot.status] ?? v.snapshot.status}</Tag><span>{v.snapshot.title}</span></Space></List.Item>
            )} />
          ) }]} />
        </>
      )}
    </Drawer>
  );
}
