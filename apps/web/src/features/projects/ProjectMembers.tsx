import { LogoutOutlined, PlusOutlined } from '@ant-design/icons';
import { ActionIconButton } from '../../components/ActionIconButton';
import { Alert, App, Button, Card, DatePicker, Form, Modal, Select, Space, Tag } from 'antd';
import { ListTable } from '../../components/ListTable';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import dayjs, { type Dayjs } from 'dayjs';
import { type ProjectRole, type RoleDefinitionRow } from '@ospm/shared';
import { leaveProjectMember } from '../../api/generated/api';
import { errorMessage, http } from '../../api/http';
import { type MemberRow, useAllUsers, useMembershipHistory } from '../../api/hooks';
import { QueryBoundary } from '../../components/EmptyState';
import { UserAvatar } from '../../components/UserAvatar';
import { fmtDate, TZ, toVN } from '../../lib/date';
import { useAuth, usePermission } from '../auth/authStore';

export function ProjectMembers({ projectKey, canManage }: { projectKey: string; canManage?: boolean }) {
  const allowAdd = usePermission(projectKey, 'project.members.create');
  const allowEdit = usePermission(projectKey, 'project.members.edit');
  const allowRemove = usePermission(projectKey, 'project.members.delete');
  const canAdd = canManage !== false && allowAdd;
  const canEdit = canManage !== false && allowEdit;
  const canRemove = canManage !== false && allowRemove;
  const auth = useAuth();
  const { data: roles = [], isLoading: loadingRoles, error: rolesError } = useQuery<RoleDefinitionRow[]>({
    queryKey: ['role-options', projectKey], queryFn: async () => (await http.get(`/api/v1/projects/${projectKey}/role-options`)).data, enabled: canAdd || canEdit,
  });
  const roleOptions = roles.map((role) => ({ value: role.builtin ? `builtin:${role.key}` : `custom:${role.id}`, label: role.name,
    disabled: role.permissions.some((permission) => !auth.hasPermission(projectKey, permission)),
  }));
  const rolePayload = (value: string): { role: ProjectRole } | { roleId: number } => value.startsWith('custom:') ? { roleId: Number(value.slice(7)) } : { role: value.slice(8) as ProjectRole };
  const { data = [], isLoading, error, refetch } = useMembershipHistory(projectKey);
  const { data: users = [] } = useAllUsers(canAdd);
  const [form] = Form.useForm<{ userId: number; role: string; joinedAt: Dayjs }>();
  const [leaving, setLeaving] = useState<MemberRow | null>(null);
  const [leftDate, setLeftDate] = useState<Dayjs | null>(null);
  const [saving, setSaving] = useState(false);
  const [changing, setChanging] = useState<number | null>(null);
  const qc = useQueryClient();
  const { message } = App.useApp();
  const reload = useAuth((s) => s.reload);
  const me = useAuth((s) => s.user);
  const nav = useNavigate();
  const today = dayjs().tz(TZ).startOf('day');
  const active = new Set(data.filter((m) => !m.leftAt).map((m) => m.userId));
  const refresh = async () => {
    await Promise.all([qc.invalidateQueries({ queryKey: ['members', projectKey] }), qc.invalidateQueries({ queryKey: ['user-detail'] }), qc.invalidateQueries({ queryKey: ['roles'] }), qc.invalidateQueries({ queryKey: ['role-options', projectKey] }), qc.invalidateQueries({ queryKey: ['projects'] }), qc.invalidateQueries({ queryKey: ['project', projectKey] }), reload()]);
  };

  async function leave() {
    if (!canRemove || !leaving || !leftDate || saving) return;
    setSaving(true);
    try {
      await leaveProjectMember(projectKey, String(leaving.userId), { leftAt: leftDate.format('YYYY-MM-DD') });
    } catch (e) {
      message.error(errorMessage(e)); setSaving(false); return;
    }
    const self = leaving.userId === me?.id && me?.systemRole !== 'admin';
    setLeaving(null);
    try {
      if (self) nav('/projects');
      await refresh();
      message.success('Đã ghi nhận ngày rời dự án');
    } catch { message.warning('Đã lưu. Vui lòng tải lại trang để cập nhật danh sách.'); }
    finally { setSaving(false); }
  }

  return <Card title="Thành viên dự án">
    {rolesError && (canAdd || canEdit) && <Alert type="error" showIcon message={errorMessage(rolesError)} style={{ marginBottom: 16 }} />}
    {canAdd && <Form form={form} layout="inline" initialValues={{ role: 'builtin:developer', joinedAt: today }}
      style={{ marginBottom: 16, gap: 8 }} disabled={saving} onFinish={async (values) => {
        if (!canAdd || saving || loadingRoles || rolesError || !roleOptions.some((role) => role.value === values.role && !role.disabled)) return;
        setSaving(true);
        try {
          await http.post(`/api/v1/projects/${projectKey}/members`, { userId: values.userId, ...rolePayload(values.role), joinedAt: values.joinedAt.format('YYYY-MM-DD') });
        } catch (e) { message.error(errorMessage(e)); setSaving(false); return; }
        form.resetFields();
        try { await refresh(); message.success('Đã thêm thành viên'); }
        catch { message.warning('Đã lưu. Vui lòng tải lại trang để cập nhật danh sách.'); }
        finally { setSaving(false); }
      }}>
      <Form.Item name="userId" label="Thành viên" rules={[{ required: true, message: 'Chọn thành viên' }]}>
        <Select showSearch optionFilterProp="label" placeholder="Chọn người dùng" style={{ width: 250 }}
          options={users.filter((u) => u.isActive && !active.has(u.id)).map((u) => ({ value: u.id, label: `${u.displayName} (${u.email})` }))} />
      </Form.Item>
      <Form.Item name="role" label="Vai trò" rules={[{ required: true }]}>
        <Select style={{ width: 170 }} loading={loadingRoles} disabled={loadingRoles || !!rolesError} options={roleOptions} />
      </Form.Item>
      <Form.Item name="joinedAt" label="Ngày tham gia" rules={[{ required: true, message: 'Chọn ngày tham gia' }]}>
        <DatePicker format="DD/MM/YYYY" maxDate={today} />
      </Form.Item>
      <Form.Item><Button type="primary" htmlType="submit" icon={<PlusOutlined />} loading={saving} disabled={loadingRoles || !!rolesError}>Thêm thành viên</Button></Form.Item>
    </Form>}
    <QueryBoundary isLoading={isLoading} error={error} refetch={refetch}>
      <ListTable<MemberRow> rowKey="id" dataSource={data} scroll={{ x: 964 }} resetKey={projectKey} columns={[
        { title: 'Thành viên', render: (_, m) => <UserAvatar user={m.user} showName /> },
        { title: 'Email', render: (_, m) => m.user.email },
        { title: 'Vai trò', render: (_, m) => canEdit && !m.leftAt ? <Select size="small" style={{ width: 170 }} value={m.roleId != null ? `custom:${m.roleId}` : `builtin:${m.role}`} optionLabelProp="label"
          aria-label={`Vai trò của ${m.user.displayName}`} disabled={saving || changing !== null || loadingRoles || !!rolesError} loading={changing === m.id || loadingRoles}
          options={roleOptions.some((option) => option.value === (m.roleId != null ? `custom:${m.roleId}` : `builtin:${m.role}`)) ? roleOptions : [...roleOptions, { value: m.roleId != null ? `custom:${m.roleId}` : `builtin:${m.role}`, label: m.roleName ?? m.role }]} onChange={async (role: string) => {
            if (!canEdit || changing !== null || saving || !roleOptions.some((option) => option.value === role && !option.disabled)) return;
            setChanging(m.id);
            try { await http.patch(`/api/v1/projects/${projectKey}/members/${m.userId}`, rolePayload(role)); }
            catch (e) { message.error(errorMessage(e)); setChanging(null); return; }
            try { await refresh(); } catch { message.warning('Đã lưu. Vui lòng tải lại trang.'); }
            finally { setChanging(null); }
          }} /> : <Tag>{m.roleName ?? m.role}</Tag> },
        { title: 'Ngày tham gia dự án', dataIndex: 'joinedAt', render: fmtDate },
        { title: 'Ngày rời dự án', dataIndex: 'leftAt', render: fmtDate },
        { title: 'Trạng thái', render: (_, m) => <Tag color={m.leftAt ? 'default' : 'green'}>{m.leftAt ? 'Đã rời' : 'Đang tham gia'}</Tag> },
        ...(canRemove ? [{ title: 'Thao tác', render: (_: unknown, m: MemberRow) => !m.leftAt ? <ActionIconButton label="Rời dự án" icon={<LogoutOutlined />} danger disabled={saving || changing !== null}
          onClick={() => { setLeaving(m); setLeftDate(today); }} /> : null }] : []),
      ]} />
    </QueryBoundary>
    <Modal maskClosable={false} title="Ghi nhận rời dự án" open={!!leaving} onCancel={() => { if (!saving) setLeaving(null); }} onOk={leave}
      okText="Xác nhận rời dự án" cancelText="Hủy" confirmLoading={saving} okButtonProps={{ danger: true, disabled: !leftDate }}
      cancelButtonProps={{ disabled: saving }} closable={!saving} keyboard={!saving}>
      <Space direction="vertical" style={{ width: '100%' }}>
        <span>Quyền thành viên của {leaving?.user.displayName} sẽ được thu hồi. Lịch sử tham gia được giữ lại.</span>
        <label htmlFor="member-left-date">Ngày rời dự án</label>
        <DatePicker id="member-left-date" value={leftDate} onChange={setLeftDate} format="DD/MM/YYYY" disabled={saving}
          minDate={leaving ? toVN(leaving.joinedAt)!.startOf('day') : undefined} maxDate={today} style={{ width: '100%' }} />
      </Space>
    </Modal>
  </Card>;
}
