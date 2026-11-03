import { App, Form, Input, Modal, Select } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { ISSUE_TYPES, PRIORITIES } from '@ospm/shared';
import { useNavigate } from 'react-router-dom';
import { useMembers } from '../../api/hooks';
import { createIssue } from '../../api/generated/api';
import { errorMessage } from '../../api/http';
import { ISSUE_TYPE_LABEL } from '../../components/IssueTypeIcon';
import { useAuth } from '../auth/authStore';
import { useCreateIssueModal } from './createIssueStore';
import { useState } from 'react';

/** Nút "+ Tạo" ở header: tạo item tay ở bất kỳ dự án nào mình có quyền developer trở lên. */
export function CreateIssueModal() {
  const { open, projectKey: preset, hide } = useCreateIssueModal();
  const { projects, hasPermission } = useAuth();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();
  const { message } = App.useApp();
  const nav = useNavigate();
  const projectKey = Form.useWatch('projectKey', form) ?? preset;
  const { data: members = [] } = useMembers(open ? projectKey : undefined);
  const options = projects.filter((p) => hasPermission(p.projectKey, 'issue.create'));
  return (
    <Modal title="Tạo item" open={open} onCancel={hide} okText="Tạo" cancelText="Hủy" confirmLoading={saving} destroyOnClose
      onOk={() => form.submit()} afterOpenChange={(o) => o && form.setFieldsValue({ projectKey: options.find((p) => p.projectKey === preset)?.projectKey ?? options[0]?.projectKey, type: 'task', priority: 'medium' })}>
      <Form form={form} layout="vertical" onFinish={async (v) => {
        if (!hasPermission(v.projectKey, 'issue.create')) return;
        setSaving(true);
        try {
          const issue = await createIssue(v.projectKey, { type: v.type, title: v.title, priority: v.priority, assigneeId: v.assigneeId });
          message.success(`Đã tạo ${issue.key}`);
          qc.invalidateQueries();
          hide();
          nav(`/browse/${issue.key}`);
        } catch (e) { message.error(errorMessage(e)); } finally { setSaving(false); }
      }}>
        <Form.Item name="projectKey" label="Dự án" rules={[{ required: true }]}>
          <Select options={options.map((p) => ({ value: p.projectKey, label: `${p.projectKey} — ${p.projectName}` }))} />
        </Form.Item>
        <Form.Item name="type" label="Loại" rules={[{ required: true }]}>
          <Select options={ISSUE_TYPES.filter((t) => t !== 'subtask').map((t) => ({ value: t, label: ISSUE_TYPE_LABEL[t] }))} />
        </Form.Item>
        <Form.Item name="title" label="Tiêu đề" rules={[{ required: true, max: 255, message: 'Nhập tiêu đề (tối đa 255 ký tự)' }]}><Input autoFocus /></Form.Item>
        <Form.Item name="priority" label="Priority"><Select options={PRIORITIES.map((p) => ({ value: p, label: p }))} /></Form.Item>
        <Form.Item name="assigneeId" label="Assignee"><Select allowClear showSearch optionFilterProp="label" options={members.map((m) => ({ value: m.userId, label: m.user.displayName }))} /></Form.Item>
      </Form>
    </Modal>
  );
}
