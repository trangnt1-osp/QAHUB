import { DeleteOutlined, EditOutlined, EyeOutlined, PlusOutlined } from '@ant-design/icons';
import { App, Button, Card, Col, Form, Input, Modal, Popconfirm, Row, Select, Space, Tag, Typography } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage, http } from '../../api/http';
import { ActionIconButton } from '../../components/ActionIconButton';
import { QueryBoundary } from '../../components/EmptyState';
import { ListTable } from '../../components/ListTable';
import { UserAvatar } from '../../components/UserAvatar';
import { usePermission } from '../auth/authStore';

const kinds = [{ value: 'dev', label: 'DEV' }, { value: 'sit', label: 'SIT' }, { value: 'uat', label: 'UAT' }, { value: 'staging', label: 'Staging' }, { value: 'production', label: 'Production' }, { value: 'other', label: 'Khác' }];
const statuses = [{ value: 'active', label: 'Hoạt động' }, { value: 'maintenance', label: 'Bảo trì' }, { value: 'inactive', label: 'Ngừng sử dụng' }];
interface Owner { id: number; displayName: string; avatarUrl?: string | null }
interface Environment {
  id: number; name: string; kind: string; appUrl: string | null; apiUrl: string | null;
  deployedVersion: string | null; ownerId: number | null; owner: Owner | null;
  status: string; notes: string | null; version: number;
}
const urlRule = { validator: (_: unknown, value?: string) => {
  if (!value?.trim()) return Promise.resolve();
  try { const url = new URL(value.trim()); if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return Promise.resolve(); } catch { /* show validation below */ }
  return Promise.reject(new Error('Nhập URL http:// hoặc https://, không chứa thông tin đăng nhập'));
} };
function EnvironmentLink({ label, value }: { label: string; value: string | null }) {
  return value ? <div><Typography.Text type="secondary">{label}: </Typography.Text><Typography.Link href={value} target="_blank" rel="noopener noreferrer" ellipsis style={{ maxWidth: 220, verticalAlign: 'bottom' }}>{value}</Typography.Link></div> : null;
}

export function ProjectEnvironments({ projectKey }: { projectKey: string }) {
  const canEdit = usePermission(projectKey, 'project.info.edit');
  const base = `/api/v1/projects/${encodeURIComponent(projectKey)}/environments`;
  const queryKey = ['project-environments', projectKey];
  const query = useQuery({ queryKey, queryFn: async () => (await http.get<Environment[]>(base)).data });
  const [editor, setEditor] = useState<{ mode: 'create' | 'view' | 'edit'; row?: Environment }>();
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<number>();
  const [search, setSearch] = useState('');
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const members = useQuery({ queryKey: ['environment-owner-options', projectKey], staleTime: 0, enabled: canEdit && !!editor && editor.mode !== 'view', queryFn: async () => (await http.get<Owner[]>(`${base}/owners`)).data });
  const readOnly = editor?.mode === 'view';
  const open = (mode: 'create' | 'view' | 'edit', row?: Environment) => { setReady(false); setEditor({ mode, row }); };
  const refresh = () => qc.invalidateQueries({ queryKey });
  const save = async () => {
    if (!editor || readOnly || !canEdit || saving || !ready) return;
    const values = await form.validateFields().catch(() => null);
    if (!values) return;
    setSaving(true);
    try {
      const payload = { ...values, name: values.name.trim(), ownerId: values.ownerId ?? null, appUrl: values.appUrl?.trim() || null, apiUrl: values.apiUrl?.trim() || null, deployedVersion: values.deployedVersion?.trim() || null, notes: values.notes?.trim() || null };
      if (editor.row) await http.patch(`${base}/${editor.row.id}`, { ...payload, version: editor.row.version });
      else await http.post(base, payload);
      message.success(editor.row ? 'Đã cập nhật môi trường' : 'Đã thêm môi trường');
      setEditor(undefined); await refresh();
    } catch (error) { message.error(errorMessage(error)); void refresh(); }
    finally { setSaving(false); }
  };
  const rows = (query.data ?? []).filter(row => `${row.name} ${row.kind} ${row.appUrl ?? ''} ${row.apiUrl ?? ''}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const ownerOptions = new Map((members.data ?? []).map(owner => [owner.id, owner]));
  if (editor?.row?.owner) ownerOptions.set(editor.row.owner.id, editor.row.owner);
  return <Card title="Môi trường" extra={<Space wrap><Input.Search aria-label="Tìm môi trường" placeholder="Tìm môi trường" allowClear value={search} onChange={event => setSearch(event.target.value)} style={{ width: 200 }} />{canEdit && <Button icon={<PlusOutlined />} onClick={() => open('create')}>Thêm môi trường</Button>}</Space>}>
    <QueryBoundary isLoading={query.isLoading} error={query.error} refetch={query.refetch}>
      <ListTable<Environment> rowKey="id" resetKey={`${projectKey}:${search}`} dataSource={rows} scroll={{ x: 1100 }} locale={{ emptyText: search ? 'Không có môi trường phù hợp' : 'Chưa có môi trường' }} columns={[
        { title: 'Tên môi trường', dataIndex: 'name', width: 180, render: (name: string, row) => <Typography.Link onClick={() => open('view', row)}>{name}</Typography.Link> },
        { title: 'Loại', dataIndex: 'kind', width: 110, render: (kind: string) => <Tag>{kinds.find(item => item.value === kind)?.label ?? kind}</Tag> },
        { title: 'Đường dẫn', key: 'urls', width: 290, render: (_, row) => row.appUrl || row.apiUrl ? <><EnvironmentLink label="Ứng dụng" value={row.appUrl} /><EnvironmentLink label="API" value={row.apiUrl} /></> : '—' },
        { title: 'Phiên bản / Build', dataIndex: 'deployedVersion', width: 150, render: (value: string | null) => value || '—' },
        { title: 'Người phụ trách', dataIndex: 'owner', width: 180, render: (owner: Owner | null) => owner ? <UserAvatar user={owner} showName /> : '—' },
        { title: 'Trạng thái', dataIndex: 'status', width: 150, render: (status: string) => <Tag color={status === 'active' ? 'green' : status === 'maintenance' ? 'orange' : 'default'}>{statuses.find(item => item.value === status)?.label ?? status}</Tag> },
        { title: 'Thao tác', width: 110, render: (_, row) => <Space size={0}>
          <ActionIconButton label="Xem môi trường" icon={<EyeOutlined />} onClick={() => open('view', row)} />
          {canEdit && <><ActionIconButton label="Sửa môi trường" icon={<EditOutlined />} onClick={() => open('edit', row)} />
            <Popconfirm title={`Xóa môi trường “${row.name}”?`} okText="Xóa" cancelText="Hủy" onConfirm={async () => {
              if (deleting !== undefined) return;
              setDeleting(row.id);
              try { await http.delete(`${base}/${row.id}`, { params: { version: row.version } }); message.success('Đã xóa môi trường'); await refresh(); }
              catch (error) { message.error(errorMessage(error)); void refresh(); } finally { setDeleting(undefined); }
            }}><ActionIconButton label="Xóa môi trường" danger icon={<DeleteOutlined />} disabled={deleting !== undefined} loading={deleting === row.id} /></Popconfirm>
          </>}
        </Space> },
      ]} />
    </QueryBoundary>
    <Modal title={readOnly ? 'Thông tin môi trường' : editor?.mode === 'edit' ? 'Sửa môi trường' : 'Thêm môi trường'} open={!!editor} width={720} destroyOnClose closable={!saving} maskClosable={!saving} keyboard={!saving} onCancel={() => !saving && setEditor(undefined)}
      afterOpenChange={visible => { if (visible) { form.resetFields(); form.setFieldsValue(editor?.row ?? { kind: 'dev', status: 'active' }); } setReady(visible); }}
      footer={<Space><Button disabled={saving} onClick={() => setEditor(undefined)}>{readOnly ? 'Đóng' : 'Hủy'}</Button>{!readOnly && <Button type="primary" onClick={() => void save()} disabled={!ready} loading={saving}>Lưu</Button>}</Space>}>
      <Form form={form} layout="vertical" disabled={readOnly || saving || !ready}>
        <Row gutter={16}><Col xs={24} sm={16}><Form.Item name="name" label="Tên môi trường" rules={[{ required: true, whitespace: true, message: 'Nhập tên môi trường' }, { max: 100 }]}><Input maxLength={100} placeholder="Ví dụ: UAT khách hàng" /></Form.Item></Col><Col xs={24} sm={8}><Form.Item name="kind" label="Loại môi trường" rules={[{ required: true }]}><Select options={kinds} /></Form.Item></Col></Row>
        <Form.Item name="appUrl" label="URL ứng dụng" rules={[urlRule, { max: 2000 }]}><Input placeholder="https://uat.example.com" /></Form.Item>
        <Form.Item name="apiUrl" label="URL API" rules={[urlRule, { max: 2000 }]}><Input placeholder="https://api-uat.example.com" /></Form.Item>
        <Row gutter={16}><Col xs={24} sm={12}><Form.Item name="deployedVersion" label="Phiên bản / Build"><Input maxLength={100} placeholder="Ví dụ: v1.2.0 / build-120" /></Form.Item></Col><Col xs={24} sm={12}><Form.Item name="status" label="Trạng thái" rules={[{ required: true }]}><Select options={statuses} /></Form.Item></Col></Row>
        <Form.Item name="ownerId" label="Người phụ trách"><Select allowClear showSearch optionFilterProp="label" loading={members.isLoading} options={[...ownerOptions.values()].map(owner => ({ value: owner.id, label: owner.displayName }))} placeholder="Chọn thành viên dự án" /></Form.Item>
        <Form.Item name="notes" label="Ghi chú"><Input.TextArea maxLength={8000} autoSize={{ minRows: 3, maxRows: 8 }} placeholder="Hướng dẫn truy cập, VPN, dữ liệu kiểm thử…" /></Form.Item>
      </Form>
    </Modal>
  </Card>;
}
