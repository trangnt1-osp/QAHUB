import { CheckOutlined, CloseOutlined, CopyOutlined } from '@ant-design/icons';
import { App, Button, Form, Input, Modal, Select, Space } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PRIORITIES } from '@ospm/shared';
import { listIssues, triageIssue } from '../../api/generated/api';
import { errorMessage } from '../../api/http';
import { useMembers, useSprints } from '../../api/hooks';
import { usePermission } from '../auth/authStore';

type Action = 'accept' | 'reject' | 'duplicate';

/** Accept / Reject / Duplicate cho bug ở trạng thái triage (chỉ tester và admin dự án). */
export function TriageButtons({ issueKey, projectKey, onDone, size = 'small' }: { issueKey: string; projectKey: string; onDone?: () => void; size?: 'small' | 'middle' }) {
  const [action, setAction] = useState<Action | null>(null);
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [dupOptions, setDupOptions] = useState<{ value: string; label: string }[]>([]);
  const canTriage = usePermission(projectKey, 'issue.triage');
  const { data: members = [] } = useMembers(action === 'accept' ? projectKey : undefined);
  const { data: sprints = [] } = useSprints(action === 'accept' ? projectKey : undefined);
  const qc = useQueryClient();
  const { message } = App.useApp();
  if (!canTriage) return null;

  const submit = async (values: Record<string, any>) => {
    if (!canTriage) return;
    setSaving(true);
    try {
      await triageIssue(issueKey, { action: action!, reason: values.reason, duplicateOfKey: values.duplicateOfKey, assigneeId: values.assigneeId, sprintId: values.sprintId, priority: values.priority });
      message.success(action === 'accept' ? 'Đã duyệt bug' : action === 'reject' ? 'Đã từ chối bug' : 'Đã đánh dấu trùng');
      setAction(null); form.resetFields();
      await qc.invalidateQueries();
      onDone?.();
    } catch (e) { message.error(errorMessage(e)); } finally { setSaving(false); }
  };

  const title = { accept: 'Duyệt bug (Accept)', reject: 'Từ chối bug (Reject)', duplicate: 'Đánh dấu trùng (Duplicate)' };
  return (
    <>
      <Space size={4} onClick={(e) => e.stopPropagation()}>
        <Button size={size} type="primary" icon={<CheckOutlined />} onClick={() => setAction('accept')}>Accept</Button>
        <Button size={size} danger icon={<CloseOutlined />} onClick={() => setAction('reject')}>Reject</Button>
        <Button size={size} icon={<CopyOutlined />} onClick={() => setAction('duplicate')}>Duplicate</Button>
      </Space>
      <Modal maskClosable={false} open={!!action} title={action ? title[action] : ''} onCancel={() => setAction(null)} onOk={() => form.submit()} confirmLoading={saving} okText="Xác nhận" cancelText="Hủy" destroyOnClose>
        <Form form={form} layout="vertical" onFinish={submit} initialValues={{ priority: undefined }}>
          {action === 'accept' && (
            <>
              <Form.Item name="assigneeId" label="Assignee"><Select allowClear showSearch optionFilterProp="label" options={members.map((m) => ({ value: m.userId, label: m.user.displayName }))} /></Form.Item>
              <Form.Item name="sprintId" label="Sprint"><Select allowClear options={sprints.map((s) => ({ value: s.id, label: `${s.name}${s.state === 'active' ? ' (đang chạy)' : ''}` }))} /></Form.Item>
              <Form.Item name="priority" label="Priority"><Select allowClear options={PRIORITIES.map((p) => ({ value: p, label: p }))} /></Form.Item>
            </>
          )}
          {action === 'reject' && <Form.Item name="reason" label="Lý do" rules={[{ required: true, message: 'Bắt buộc nhập lý do' }]}><Input.TextArea rows={3} autoFocus /></Form.Item>}
          {action === 'duplicate' && (
            <Form.Item name="duplicateOfKey" label="Bug gốc" rules={[{ required: true, message: 'Chọn bug gốc' }]}>
              <Select showSearch filterOption={false} placeholder="Gõ mã hoặc tiêu đề bug…" options={dupOptions}
                onSearch={async (q) => {
                  const r = await listIssues(projectKey, { q, type: ['bug'], limit: 20 } as any);
                  setDupOptions(r.items.filter((i: any) => i.key !== issueKey).map((i: any) => ({ value: i.key, label: `${i.key} — ${i.title}` })));
                }} />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </>
  );
}
