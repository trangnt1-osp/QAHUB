import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { App, Button, Card, Col, Drawer, Form, Input, Row, Space, Tag, Typography } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { normalizePermissions, type Permission, type RoleDefinitionRow } from '@ospm/shared';
import { errorMessage, http } from '../../api/http';
import { ActionIconButton } from '../../components/ActionIconButton';
import { QueryBoundary } from '../../components/EmptyState';
import { ListTable } from '../../components/ListTable';
import { useAuth } from '../auth/authStore';
import { PermissionEditor } from './PermissionEditor';

type RoleValues = { name: string; key: string; description: string };

export function RolesPage() {
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  const reload = useAuth((state) => state.reload);
  const [form] = Form.useForm<RoleValues>();
  const [editing, setEditing] = useState<RoleDefinitionRow | 'new' | null>(null);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);
  const { data = [], isLoading, error, refetch } = useQuery<RoleDefinitionRow[]>({
    queryKey: ['roles'], queryFn: async () => (await http.get('/api/v1/roles')).data,
  });
  const builtin = editing !== null && editing !== 'new' && editing.builtin;
  const refresh = () => Promise.all([qc.invalidateQueries(), reload()]);
  function open(role: RoleDefinitionRow | 'new') {
    setEditing(role);
    form.resetFields();
    form.setFieldsValue(role === 'new' ? { name: '', key: '', description: '' } : { ...role, description: role.description ?? '' });
    setPermissions(role === 'new' ? [] : normalizePermissions(role.permissions));
  }
  async function save(values: RoleValues) {
    if (!editing || saving) return;
    setSaving(true);
    try {
      const payload = { name: values.name.trim(), key: values.key.trim(), description: values.description?.trim() || null, permissions: normalizePermissions(permissions) };
      if (editing === 'new') await http.post('/api/v1/roles', payload);
      else if (editing.builtin) await http.patch(`/api/v1/roles/builtin/${editing.key}`, { permissions: payload.permissions });
      else await http.patch(`/api/v1/roles/${editing.id}`, payload);
    } catch (e) { message.error(errorMessage(e)); setSaving(false); return; }
    setEditing(null);
    try { await refresh(); message.success('Đã lưu vai trò'); }
    catch { message.warning('Đã lưu. Vui lòng tải lại trang để cập nhật quyền.'); }
    finally { setSaving(false); }
  }
  function remove(role: RoleDefinitionRow) {
    if (role.builtin || role.id === null || role.memberCount > 0) return;
    modal.confirm({ title: `Xóa vai trò ${role.name}?`, content: 'Vai trò đang được gán cho thành viên không thể xóa.', okText: 'Xóa', cancelText: 'Hủy', okButtonProps: { danger: true },
      onOk: async () => {
        setDeleting(role.id);
        try { await http.delete(`/api/v1/roles/${role.id}`); }
        catch (e) { message.error(errorMessage(e)); setDeleting(null); throw e; }
        try { await refresh(); message.success('Đã xóa vai trò'); }
        catch { message.warning('Đã xóa. Vui lòng tải lại trang.'); }
        finally { setDeleting(null); }
      },
    });
  }
  return <Card title="Quản lý vai trò" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => open('new')}>Thêm vai trò</Button>}>
    <QueryBoundary isLoading={isLoading} error={error} refetch={refetch}>
      <ListTable<RoleDefinitionRow> rowKey={(role) => role.builtin ? `builtin:${role.key}` : `custom:${role.id}`} dataSource={data} scroll={{ x: 850 }} columns={[
        { title: 'Tên vai trò', dataIndex: 'name' },
        { title: 'Mã', dataIndex: 'key' },
        { title: 'Mô tả', dataIndex: 'description', render: (value) => value || '—' },
        { title: 'Loại', render: (_, role) => <Tag color={role.builtin ? 'default' : 'blue'}>{role.builtin ? 'Mặc định' : 'Tùy chỉnh'}</Tag> },
        { title: 'Thành viên', dataIndex: 'memberCount' },
        { title: 'Thao tác', render: (_, role) => <Space>
          <ActionIconButton label="Sửa vai trò" icon={<EditOutlined />} onClick={() => open(role)} />
          {!role.builtin && <ActionIconButton label={role.memberCount > 0 ? 'Không thể xóa vai trò đã được gán' : 'Xóa vai trò'} icon={<DeleteOutlined />} danger disabled={role.memberCount > 0 || deleting !== null} loading={deleting === role.id} onClick={() => remove(role)} />}
        </Space> },
      ]} />
    </QueryBoundary>
    <Drawer maskClosable={false} title={editing === 'new' ? 'Thêm vai trò' : 'Sửa vai trò'} open={editing !== null} width="min(960px, 100vw)"
      onClose={() => { if (!saving) setEditing(null); }} closable={!saving} keyboard={!saving}
      footer={<Space style={{ display: 'flex', justifyContent: 'flex-end' }}><Button disabled={saving} onClick={() => setEditing(null)}>Hủy</Button><Button type="primary" aria-label="Lưu" loading={saving} onClick={() => form.submit()}>Lưu</Button></Space>}>
      <Form form={form} layout="vertical" disabled={saving} onFinish={save}>
        <Row gutter={16}>
          <Col xs={24} sm={12}><Form.Item name="name" label="Tên vai trò" style={{ marginBottom: 12 }} rules={[{ required: true, whitespace: true, message: 'Nhập tên vai trò' }]}><Input disabled={builtin || saving} maxLength={100} /></Form.Item></Col>
          <Col xs={24} sm={12}><Form.Item name="key" label="Mã vai trò" style={{ marginBottom: 12 }} rules={[{ required: true, message: 'Nhập mã vai trò' }, { pattern: /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, message: 'Dùng chữ thường, số và dấu gạch ngang giữa các từ; bắt đầu bằng chữ.' }]}><Input disabled={builtin || saving} maxLength={64} /></Form.Item></Col>
        </Row>
        {!builtin && <Form.Item name="description" label="Mô tả" style={{ marginBottom: 16 }}><Input.TextArea disabled={saving} autoSize={{ minRows: 1, maxRows: 3 }} maxLength={1000} /></Form.Item>}
      </Form>
      {builtin && <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>Áp dụng cho thành viên ở mọi dự án. Admin hệ thống luôn toàn quyền.</Typography.Paragraph>}
      {editing && <PermissionEditor value={permissions} onChange={setPermissions} disabled={saving} />}
    </Drawer>
  </Card>;
}
