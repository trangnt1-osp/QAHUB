import { Alert, App, Button, Col, Drawer, Form, Input, Row, Select, Space, Switch, Tag, Typography } from 'antd';
import { ListTable } from '../../components/ListTable';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { SYSTEM_ROLES, type ProjectRole, type RoleDefinitionRow, type SystemRole } from '@ospm/shared';
import { getUserDetail, updateUser } from '../../api/generated/api';
import { errorCode, errorMessage, http } from '../../api/http';
import { QueryBoundary } from '../../components/EmptyState';
import { fmtDate, fmtDateTime } from '../../lib/date';
import { useAuth } from '../auth/authStore';

export type UserDetailMode = 'view' | 'edit';

interface UserValues {
  displayName: string;
  email: string;
  systemRole: SystemRole;
  isActive: boolean;
}

interface Participation {
  id: number;
  role: ProjectRole;
  roleId?: number | null;
  roleName?: string;
  joinedAt: string;
  leftAt: string | null;
  project: { id: number; key: string; name: string; deletedAt: string | null };
}

interface UserDetail {
  user: { id: number; displayName: string; email: string; systemRole: SystemRole; isActive: boolean; lastLoginAt: string | null };
  projects: Participation[];
}

export function UserDetailDrawer({ userId, initialMode = 'view', onClose }: { userId: number; initialMode?: UserDetailMode; onClose: () => void }) {
  const [editing, setEditing] = useState(initialMode === 'edit');
  const [saving, setSaving] = useState(false);
  const [pendingRoles, setPendingRoles] = useState<Record<number, string>>({});
  const [form] = Form.useForm<UserValues>();
  const dirty = useRef(false);
  const qc = useQueryClient();
  const { message } = App.useApp();
  const me = useAuth((s) => s.user);
  const reloadMe = useAuth((s) => s.reload);
  const isSelf = userId === me?.id;
  const { data, isLoading, isFetching, error, refetch } = useQuery<UserDetail>({
    queryKey: ['user-detail', userId], queryFn: () => getUserDetail(String(userId)), staleTime: 0,
  });
  const { data: roles = [], isLoading: rolesLoading, error: rolesError, refetch: refetchRoles } = useQuery<RoleDefinitionRow[]>({
    queryKey: ['roles'], queryFn: async () => (await http.get('/api/v1/roles')).data, enabled: editing && me?.systemRole === 'admin', staleTime: 0,
  });
  const roleOptions = roles.map((role) => ({ value: role.builtin ? `builtin:${role.key}` : `custom:${role.id}`, label: role.name }));
  const roleValue = (membership: Participation) => membership.roleId != null ? `custom:${membership.roleId}` : `builtin:${membership.role}`;
  useEffect(() => {
    if (data && !dirty.current) form.setFieldsValue(data.user);
  }, [data, form]);

  const close = () => { if (!saving) onClose(); };
  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: ['users'] }), qc.invalidateQueries({ queryKey: ['members'] }),
    qc.invalidateQueries({ queryKey: ['user-detail', userId] }), qc.invalidateQueries({ queryKey: ['roles'] }),
    qc.invalidateQueries({ queryKey: ['role-options'] }), qc.invalidateQueries({ queryKey: ['projects'] }),
    qc.invalidateQueries({ queryKey: ['project'] }), reloadMe(),
  ]);
  async function save(values: UserValues) {
    if (!editing || saving || isFetching) return;
    setSaving(true);
    let profileSaved = false;
    let projectSaving: string | undefined;
    try {
      const updated = await updateUser(String(userId), {
        displayName: values.displayName.trim(), email: values.email.trim(),
        ...(!isSelf ? { systemRole: values.systemRole, isActive: values.isActive } : {}),
      });
      profileSaved = true;
      qc.setQueryData<UserDetail>(['user-detail', userId], (current) => current ? { ...current, user: { ...current.user, ...updated } } : current);
      for (const membership of data?.projects ?? []) {
        const selected = pendingRoles[membership.id];
        if (!selected || selected === roleValue(membership) || membership.leftAt || membership.project.deletedAt) continue;
        projectSaving = membership.project.key;
        const payload = selected.startsWith('custom:') ? { roleId: Number(selected.slice(7)) } : { role: selected.slice(8) as ProjectRole };
        const { data: assignment } = await http.patch(`/api/v1/projects/${membership.project.key}/members/${userId}`, payload);
        const role = roles.find((option) => (option.builtin ? `builtin:${option.key}` : `custom:${option.id}`) === selected);
        qc.setQueryData<UserDetail>(['user-detail', userId], (current) => current ? { ...current, projects: current.projects.map((entry) => entry.id === membership.id ? { ...entry, role: assignment.role, roleId: assignment.roleId, roleName: role?.name ?? assignment.role } : entry) } : current);
        setPendingRoles((current) => { const next = { ...current }; delete next[membership.id]; return next; });
      }
    } catch (e) {
      if (profileSaved) {
        message.error(`Thông tin người dùng đã lưu; chưa cập nhật được vai trò dự án ${projectSaving}: ${errorMessage(e)}`);
        await refresh().catch(() => undefined);
      } else if (errorCode(e) === 'EMAIL_TAKEN') form.setFields([{ name: 'email', errors: ['Email đã được sử dụng'] }]);
      else message.error(errorMessage(e));
      setSaving(false);
      return;
    }
    try {
      await refresh();
      message.success('Đã cập nhật người dùng');
      onClose();
    } catch {
      message.warning('Đã lưu thay đổi. Vui lòng tải lại trang để cập nhật thông tin.');
      onClose();
    } finally { setSaving(false); }
  }

  return <Drawer maskClosable={false} title="Thông tin người dùng" open onClose={close} width="min(960px, 100vw)"
    closable={!saving} keyboard={!saving}
    extra={<Tag color={editing ? 'blue' : 'default'}>{editing ? 'Chỉnh sửa' : 'Chỉ xem'}</Tag>}
    footer={<Space style={{ display: 'flex', justifyContent: 'flex-end' }}>
      <Button disabled={saving} onClick={close}>{editing ? 'Hủy' : 'Đóng'}</Button>
      {editing ? <Button type="primary" loading={saving} disabled={!data || !!error || isFetching} onClick={() => form.submit()}>Lưu</Button>
        : <Button type="primary" disabled={!data || !!error || isFetching} onClick={() => { dirty.current = false; form.setFieldsValue(data!.user); setEditing(true); }}>Sửa</Button>}
    </Space>}>
    <QueryBoundary isLoading={isLoading} error={error} refetch={refetch}>
      {data && <>
        <Form form={form} name="member-details" layout="vertical" initialValues={data.user} disabled={saving || isFetching}
          onValuesChange={() => { dirty.current = true; }} onFinish={save}>
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item name="displayName" label="Tên hiển thị" rules={[{ required: true, whitespace: true, message: 'Vui lòng nhập tên hiển thị' }]}>
                <Input readOnly={!editing} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="email" label="Email" rules={[{ required: true, message: 'Vui lòng nhập email' }, { type: 'email', transform: (v: string) => v?.trim(), message: 'Email không hợp lệ' }]}>
                <Input readOnly={!editing} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="systemRole" label="Vai trò hệ thống" rules={[{ required: true }]}
                extra="Quyền quản trị toàn hệ thống (admin/member). QC và các vai trò dự án được chọn ở bảng bên dưới.">
                <Select disabled={!editing || saving || isFetching || isSelf} options={SYSTEM_ROLES.map((r) => ({ value: r, label: r }))} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="isActive" label="Trạng thái" valuePropName="checked"
                extra={isSelf ? 'Bạn không thể tự khóa hoặc thay đổi vai trò của chính mình.' : undefined}>
                <Switch disabled={!editing || saving || isFetching || isSelf} checkedChildren="Hoạt động" unCheckedChildren="Đã khóa" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="Đăng nhập cuối" htmlFor="member-last-login">
                <Input id="member-last-login" value={fmtDateTime(data.user.lastLoginAt)} readOnly />
              </Form.Item>
            </Col>
          </Row>
        </Form>
        <Typography.Title level={5}>Lịch sử dự án tham gia</Typography.Title>
        {editing && <Typography.Paragraph type="secondary">Chọn vai trò cho từng dự án rồi bấm Lưu. Các lần tham gia đã kết thúc chỉ được xem.</Typography.Paragraph>}
        {editing && rolesError && <Alert type="error" showIcon message="Không tải được danh sách vai trò" action={<Button onClick={() => void refetchRoles()}>Thử lại</Button>} style={{ marginBottom: 12 }} />}
        <ListTable<Participation> rowKey="id" dataSource={data.projects} scroll={{ x: 824 }} resetKey={String(userId)}
          locale={{ emptyText: 'Chưa tham gia dự án nào' }} columns={[
            { title: 'Mã dự án', render: (_, m) => m.project.deletedAt ? m.project.key : <Link to={`/projects/${m.project.key}/info`}
              aria-disabled={saving} onClick={(e) => { if (saving) e.preventDefault(); else onClose(); }}>{m.project.key}</Link> },
            { title: 'Dự án', render: (_, m) => m.project.name },
            { title: 'Vai trò', width: 180, render: (_, membership) => editing && !membership.leftAt && !membership.project.deletedAt ? <Select
              aria-label={`Vai trò tại ${membership.project.key}`} style={{ width: '100%' }} loading={rolesLoading}
              disabled={saving || isFetching || rolesLoading || !!rolesError} value={pendingRoles[membership.id] ?? roleValue(membership)}
              options={roleOptions.some((option) => option.value === roleValue(membership)) ? roleOptions : [...roleOptions, { value: roleValue(membership), label: membership.roleName ?? membership.role }]}
              onChange={(value: string) => { dirty.current = true; setPendingRoles((current) => ({ ...current, [membership.id]: value })); }} /> : <Tag>{membership.roleName ?? membership.role}</Tag> },
            { title: 'Ngày tham gia', dataIndex: 'joinedAt', render: fmtDate },
            { title: 'Ngày rời dự án', dataIndex: 'leftAt', render: fmtDate },
            { title: 'Trạng thái', render: (_, m) => m.project.deletedAt ? <Tag>Dự án đã xóa</Tag>
              : m.leftAt ? <Tag>Đã rời</Tag> : <Tag color="green">Đang tham gia</Tag> },
          ]} />
      </>}
    </QueryBoundary>
  </Drawer>;
}
