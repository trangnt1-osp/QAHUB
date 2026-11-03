import { Alert, App, DatePicker, Form, Input, Modal, Radio, Space, Typography } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { completeSprint, startSprint, updateSprint } from '../../api/generated/api';
import { errorMessage } from '../../api/http';
import type { Sprint } from '../../api/models';

export function StartSprintModal({ sprint, open, onClose }: { sprint: Sprint | null; open: boolean; onClose: () => void }) {
  const [form] = Form.useForm();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [saving, setSaving] = useState(false);
  const label = sprint?.kind === 'phase' ? 'phase' : 'sprint';
  useEffect(() => { if (open && sprint) form.setFieldsValue({ range: [sprint.startDate ? dayjs(sprint.startDate) : dayjs(), sprint.endDate ? dayjs(sprint.endDate) : dayjs(sprint.startDate ?? undefined).add(14, 'day')], goal: sprint.goal }); }, [open, sprint, form]);
  return <Modal title={`Bắt đầu ${sprint?.name ?? ''}`} open={open} onCancel={onClose} onOk={() => form.submit()} confirmLoading={saving} okText="Bắt đầu" cancelText="Hủy" destroyOnClose>
    <Form form={form} layout="vertical" disabled={saving} onFinish={async (v) => {
      if (!sprint || saving) return;
      setSaving(true);
      try { await startSprint(String(sprint.id), { startDate: v.range[0].format('YYYY-MM-DD'), endDate: v.range[1].format('YYYY-MM-DD'), goal: v.goal }); message.success(`Đã bắt đầu ${label}`); await qc.invalidateQueries(); onClose(); }
      catch (e) { message.error(errorMessage(e)); } finally { setSaving(false); }
    }}>
      <Form.Item name="range" label="Thời gian" rules={[{ required: true, message: 'Chọn thời gian' }]}><DatePicker.RangePicker format="DD/MM/YYYY" style={{ width: '100%' }} /></Form.Item>
      <Form.Item name="goal" label={`Mục tiêu ${label}`}><Input.TextArea rows={2} /></Form.Item>
    </Form>
  </Modal>;
}

export function EditSprintModal({ sprint, open, onClose }: { sprint: Sprint | null; open: boolean; onClose: () => void }) {
  const [form] = Form.useForm();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [saving, setSaving] = useState(false);
  const label = sprint?.kind === 'phase' ? 'phase' : 'sprint';
  useEffect(() => { if (open && sprint) form.setFieldsValue({ name: sprint.name, goal: sprint.goal, range: sprint.startDate || sprint.endDate ? [sprint.startDate ? dayjs(sprint.startDate) : null, sprint.endDate ? dayjs(sprint.endDate) : null] : undefined }); }, [open, sprint, form]);
  return <Modal title={`Sửa ${label}`} open={open} onCancel={onClose} onOk={() => form.submit()} confirmLoading={saving} okText="Lưu" cancelText="Hủy" destroyOnClose>
    <Form form={form} layout="vertical" disabled={saving} onFinish={async (v) => {
      if (!sprint || saving) return;
      setSaving(true);
      try { await updateSprint(String(sprint.id), { name: v.name.trim(), goal: v.goal ?? null, startDate: v.range?.[0]?.format('YYYY-MM-DD') ?? null, endDate: v.range?.[1]?.format('YYYY-MM-DD') ?? null }); await qc.invalidateQueries(); onClose(); }
      catch (e) { message.error(errorMessage(e)); } finally { setSaving(false); }
    }}>
      <Form.Item name="name" label="Tên" rules={[{ required: true, whitespace: true, message: 'Nhập tên' }]}><Input /></Form.Item>
      <Form.Item name="goal" label="Mục tiêu"><Input.TextArea rows={2} /></Form.Item>
      <Form.Item name="range" label="Thời gian"><DatePicker.RangePicker allowEmpty={[true, true]} format="DD/MM/YYYY" style={{ width: '100%' }} /></Form.Item>
    </Form>
  </Modal>;
}

export function CompleteSprintModal({ sprint, done, open, notDone, futureSprints, onClose }: {
  sprint: Sprint | null; done: number; notDone: number; open: boolean; futureSprints: Sprint[]; onClose: () => void;
}) {
  const [target, setTarget] = useState<string>('backlog');
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();
  const { message } = App.useApp();
  const phase = sprint?.kind === 'phase';
  const label = phase ? 'phase' : 'sprint';
  useEffect(() => { if (open) setTarget('backlog'); }, [open]);
  return <Modal title={`Hoàn thành ${sprint?.name ?? ''}`} open={open} onCancel={onClose} okText={`Hoàn thành ${label}`} cancelText="Hủy" confirmLoading={saving} destroyOnClose
    okButtonProps={{ disabled: phase && notDone > 0 }} onOk={async () => {
      if (!sprint || saving || (phase && notDone > 0)) return;
      setSaving(true);
      try { await completeSprint(String(sprint.id), { moveOpenIssuesTo: phase ? 'backlog' : target }); message.success(`Đã hoàn thành ${label}`); await qc.invalidateQueries(); onClose(); }
      catch (e) { message.error(errorMessage(e)); } finally { setSaving(false); }
    }}>
    <Space direction="vertical" style={{ width: '100%' }}>
      <Typography.Text><b>{done}</b> item đã xong, <b>{notDone}</b> item chưa xong.</Typography.Text>
      {phase && notDone > 0 && <Alert type="warning" showIcon message="Cần hoàn thành tất cả item trước khi hoàn thành phase." />}
      {!phase && notDone > 0 && <>
        <Typography.Text>Chuyển các item chưa xong tới:</Typography.Text>
        <Radio.Group value={target} onChange={(e) => setTarget(e.target.value)} disabled={saving}>
          <Space direction="vertical"><Radio value="backlog">Backlog</Radio>{futureSprints.map((s) => <Radio key={s.id} value={String(s.id)}>{s.name}</Radio>)}</Space>
        </Radio.Group>
      </>}
    </Space>
  </Modal>;
}
