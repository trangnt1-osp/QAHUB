import { App, Form, Input, Modal, Select } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { updateProject } from '../../api/generated/api';
import { errorMessage } from '../../api/http';
import { useAllUsers } from '../../api/hooks';
import type { ProjectRow } from '../../api/models';
import { useAuth } from '../auth/authStore';
import { ProjectDateFields, projectDateInitialValues, projectDatePayload, type ProjectDateValues } from './ProjectDateFields';

interface EditProjectValues extends ProjectDateValues {
  name: string;
  description?: string;
  leadId?: number | null;
}

export function EditProjectModal({ project, onClose }: { project: ProjectRow; onClose: () => void }) {
  const [form] = Form.useForm<EditProjectValues>();
  const [saving, setSaving] = useState(false);
  const { data: users = [] } = useAllUsers();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const reload = useAuth((s) => s.reload);

  async function save(values: EditProjectValues) {
    if (saving) return;
    setSaving(true);
    try {
      await updateProject(project.key, {
        name: values.name.trim(), description: values.description ?? '', leadId: values.leadId ?? null,
        ...projectDatePayload(values),
      });
    } catch (e) {
      message.error(errorMessage(e));
      setSaving(false);
      return;
    }
    try {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['projects'] }),
        qc.invalidateQueries({ queryKey: ['project', project.key] }),
        reload(),
      ]);
      message.success('Đã cập nhật dự án');
      onClose();
    } catch {
      message.warning('Đã lưu thay đổi. Vui lòng tải lại trang để cập nhật thông tin.');
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return <Modal title="Sửa dự án" open onCancel={() => { if (!saving) onClose(); }}
    onOk={() => form.submit()} okText="Lưu" cancelText="Hủy" confirmLoading={saving}
    cancelButtonProps={{ disabled: saving }} closable={!saving} maskClosable={!saving} keyboard={!saving}>
    <Form form={form} layout="vertical" disabled={saving} onFinish={save}
      initialValues={{ name: project.name, description: project.description ?? '', leadId: project.lead?.id, ...projectDateInitialValues(project) }}>
      <Form.Item label="Mã dự án"><Input value={project.key} disabled /></Form.Item>
      <Form.Item name="name" label="Tên dự án" rules={[{ required: true, whitespace: true, message: 'Vui lòng nhập tên dự án' }]}><Input autoFocus /></Form.Item>
      <Form.Item name="description" label="Mô tả"><Input.TextArea rows={2} /></Form.Item>
      <Form.Item name="leadId" label="Lead">
        <Select allowClear showSearch optionFilterProp="label" options={users.filter((u) => u.isActive || u.id === project.lead?.id).map((u) => ({ value: u.id, label: u.displayName }))} />
      </Form.Item>
      <ProjectDateFields />
    </Form>
  </Modal>;
}
