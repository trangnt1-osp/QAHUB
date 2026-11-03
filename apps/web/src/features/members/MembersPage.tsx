import { EditOutlined, EyeOutlined, KeyOutlined, PlusOutlined } from '@ant-design/icons';
import { ActionIconButton } from '../../components/ActionIconButton';
import { App, Button, Form, Input, Modal, Popconfirm, Select, Space, Switch, Typography } from 'antd';
import { ListTable } from '../../components/ListTable';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { SYSTEM_ROLES } from '@ospm/shared';
import {
  createUser, resetUserPassword, updateUser,
} from '../../api/generated/api';
import { errorMessage } from '../../api/http';
import { useAllUsers } from '../../api/hooks';
import { UserAvatar } from '../../components/UserAvatar';
import { fmtDateTime } from '../../lib/date';
import { useAuth } from '../auth/authStore';
import { UserDetailDrawer, type UserDetailMode } from './UserDetailDrawer';

export function MembersPage() {
  const isAdmin = useAuth((s) => s.isSystemAdmin());
  return (
    <div className="page">
      <Typography.Title level={3} style={{ marginTop: 0 }}>Người dùng</Typography.Title>
      {isAdmin ? <UsersTab /> : <Typography.Text>Bạn không có quyền quản lý người dùng.</Typography.Text>}
    </div>
  );
}
function UsersTab() {
  const { data = [], isLoading } = useAllUsers();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<{ userId: number; mode: UserDetailMode } | null>(null);
  const [form] = Form.useForm();
  const qc = useQueryClient();
  const { message, modal } = App.useApp();
  const me = useAuth((s) => s.user);
  return (
    <>
      <Button type="primary" icon={<PlusOutlined />} style={{ marginBottom: 12 }} onClick={() => setOpen(true)}>Thêm người dùng</Button>
      <ListTable rowKey="id" loading={isLoading} dataSource={data} size="middle" style={{ background: '#fff' }} columns={[
        { title: 'Tên', dataIndex: 'displayName', render: (_, u: any) => <UserAvatar user={u} showName /> },
        { title: 'Email', dataIndex: 'email' },
        { title: 'Vai trò hệ thống', dataIndex: 'systemRole', render: (r, u: any) => (
          <Select size="small" value={r} style={{ width: 110 }} disabled={u.id === me?.id} options={SYSTEM_ROLES.map((x) => ({ value: x, label: x }))}
            onChange={async (v) => { try { await updateUser(String(u.id), { systemRole: v }); await qc.invalidateQueries({ queryKey: ['users'] }); } catch (e) { message.error(errorMessage(e)); } }} />
        ) },
        { title: 'Trạng thái', dataIndex: 'isActive', render: (a, u: any) => (
          <Switch checked={a} disabled={u.id === me?.id} checkedChildren="Hoạt động" unCheckedChildren="Đã khóa"
            onChange={async (v) => { try { await updateUser(String(u.id), { isActive: v }); await qc.invalidateQueries({ queryKey: ['users'] }); } catch (e) { message.error(errorMessage(e)); } }} />
        ) },
        { title: 'Đăng nhập cuối', dataIndex: 'lastLoginAt', render: fmtDateTime },
        { title: 'Thao tác', render: (_, u: { id: number }) => (
          <Space size={4}>
          <ActionIconButton label="Xem" icon={<EyeOutlined />} onClick={() => setSelected({ userId: u.id, mode: 'view' })} />
          <ActionIconButton label="Sửa" icon={<EditOutlined />} onClick={() => setSelected({ userId: u.id, mode: 'edit' })} />
          <Popconfirm title="Đặt lại mật khẩu cho người dùng này?" onConfirm={async () => {
            try { const r = await resetUserPassword(String(u.id)); modal.info({ title: 'Mật khẩu tạm', content: <div>Chỉ hiển thị một lần:<br /><Typography.Text copyable code>{r.temporaryPassword}</Typography.Text></div> }); }
            catch (e) { message.error(errorMessage(e)); }
          }}><ActionIconButton label="Đặt lại mật khẩu" icon={<KeyOutlined />} /></Popconfirm>
          </Space>
        ) },
      ]} />
      {selected && <UserDetailDrawer key={selected.userId} userId={selected.userId} initialMode={selected.mode} onClose={() => setSelected(null)} />}
      <Modal title="Thêm người dùng" open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} okText="Tạo" cancelText="Hủy" destroyOnClose>
        <Form form={form} layout="vertical" initialValues={{ systemRole: 'member' }} onFinish={async (v) => {
          try { await createUser(v); message.success('Đã tạo người dùng'); await qc.invalidateQueries({ queryKey: ['users'] }); setOpen(false); form.resetFields(); } catch (e) { message.error(errorMessage(e)); }
        }}>
          <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}><Input /></Form.Item>
          <Form.Item name="displayName" label="Tên hiển thị" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="systemRole" label="Vai trò hệ thống"><Select options={SYSTEM_ROLES.map((x) => ({ value: x, label: x }))} /></Form.Item>
          <Form.Item name="password" label="Mật khẩu" rules={[{ required: true, min: 8, message: 'Tối thiểu 8 ký tự' }]}><Input.Password /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}
