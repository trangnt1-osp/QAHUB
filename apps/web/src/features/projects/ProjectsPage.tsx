import { EditOutlined, PlusOutlined } from '@ant-design/icons';
import { ActionIconButton } from '../../components/ActionIconButton';
import { App, Badge, Button, Form, Input, Modal, Select, Tag } from 'antd';
import { ListTable } from '../../components/ListTable';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PROJECT_KEY_REGEX } from '@ospm/shared';
import { createProject, listProjects } from '../../api/generated/api';
import { errorMessage } from '../../api/http';
import { useAllUsers, useWorkflowTemplates } from '../../api/hooks';
import type { ProjectRow } from '../../api/models';
import { QueryBoundary } from '../../components/EmptyState';
import { UserAvatar } from '../../components/UserAvatar';
import { fmtDate } from '../../lib/date';
import { useAuth } from '../auth/authStore';
import { EditProjectModal } from './EditProjectModal';
import { ProjectDateFields, projectDatePayload } from './ProjectDateFields';

export function ProjectsPage() {
  const { data = [], isLoading, error, refetch } = useQuery<ProjectRow[]>({ queryKey: ['projects'], queryFn: () => listProjects() });
  const isAdmin = useAuth((s) => s.isSystemAdmin());
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectRow | null>(null);
  const nav = useNavigate();
  return (
    <div className="page">
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        {isAdmin && <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>Tạo dự án</Button>}
      </div>
      <QueryBoundary isLoading={isLoading} error={error} refetch={refetch} empty={!data.length} emptyTitle="Bạn chưa tham gia dự án nào">
        <ListTable<ProjectRow> rowKey="id" dataSource={data} size="middle" style={{ background: '#fff' }}
          onRow={(r) => ({ onClick: () => nav(`/projects/${r.key}/summary`), style: { cursor: 'pointer' } })}
          columns={[
            { title: 'Key', dataIndex: 'key', width: 90, render: (k) => <Link to={`/projects/${k}/summary`} onClick={(e) => e.stopPropagation()}><b>{k}</b></Link> },
            { title: 'Tên', dataIndex: 'name' },
            { title: 'Ngày bắt đầu', dataIndex: 'startDate', render: fmtDate },
            { title: 'Ngày kết thúc', dataIndex: 'endDate', render: fmtDate },
            { title: 'Lead', dataIndex: 'lead', render: (l) => (l ? <UserAvatar user={l} showName /> : '—') },
            { title: 'Item mở', dataIndex: 'openIssues', align: 'right' },
            { title: 'Bug auto chờ duyệt', dataIndex: 'pendingReview', align: 'right', render: (n) => (n ? <Badge count={n} color="#722ed1" /> : 0) },
            { title: 'Sprint đang chạy', dataIndex: 'activeSprint', render: (s) => (s ? <Tag color="blue">{s.name}</Tag> : <span className="muted">—</span>) },
            { title: 'Ngày tạo', dataIndex: 'createdAt', render: fmtDate },
            { title: 'Thao tác', render: (_, project) => project.myRole === 'admin' ? (
              <ActionIconButton label="Sửa" icon={<EditOutlined />} onClick={() => setEditing(project)} />
            ) : null },
          ]} />
      </QueryBoundary>
      <CreateProjectModal open={open} onClose={() => setOpen(false)} />
      {editing && <EditProjectModal key={editing.id} project={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function CreateProjectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form] = Form.useForm();
  const { data: templates = [] } = useWorkflowTemplates();
  const { data: users = [] } = useAllUsers();
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();
  const { message } = App.useApp();
  const reload = useAuth((s) => s.reload);
  return (
    <Modal title="Tạo dự án" open={open} onCancel={onClose} onOk={() => form.submit()} confirmLoading={saving} okText="Tạo" cancelText="Hủy" destroyOnClose>
      <Form form={form} layout="vertical" onFinish={async (v) => {
        setSaving(true);
        try {
          await createProject({ key: v.key, name: v.name, description: v.description, leadId: v.leadId, workflowTemplateId: v.workflowTemplateId, ...projectDatePayload(v) });
          message.success('Đã tạo dự án'); await qc.invalidateQueries(); await reload(); onClose(); form.resetFields();
        } catch (e) { message.error(errorMessage(e)); } finally { setSaving(false); }
      }}>
        <Form.Item name="key" label="Key" tooltip="2–10 ký tự, chỉ A–Z và 0–9, bắt đầu bằng chữ" normalize={(v) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')}
          rules={[{ required: true }, { pattern: PROJECT_KEY_REGEX, message: 'Key gồm 2–10 ký tự A–Z, 0–9, bắt đầu bằng chữ' }]}><Input maxLength={10} /></Form.Item>
        <Form.Item name="name" label="Tên dự án" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="description" label="Mô tả"><Input.TextArea rows={2} /></Form.Item>
        <Form.Item name="leadId" label="Lead"><Select allowClear showSearch optionFilterProp="label" options={users.filter((u) => u.isActive).map((u) => ({ value: u.id, label: u.displayName }))} /></Form.Item>
        <ProjectDateFields />
        <Form.Item name="workflowTemplateId" label="Workflow template" rules={[{ required: true, message: 'Chọn template' }]}><Select options={templates.map((t) => ({ value: t.id, label: t.name }))} /></Form.Item>
      </Form>
    </Modal>
  );
}
