import { LogoutOutlined, PlusOutlined } from '@ant-design/icons';
import { ActionIconButton } from '../../components/ActionIconButton';
import { App, Button, Card, DatePicker, Form, Modal, Select, Space, Tag } from 'antd';
import { ListTable } from '../../components/ListTable';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import dayjs, { type Dayjs } from 'dayjs';
import { PROJECT_ROLES, type ProjectRole } from '@ospm/shared';
import { addProjectMember, leaveProjectMember, updateProjectMember } from '../../api/generated/api';
import { errorMessage } from '../../api/http';
import { type MemberRow, useAllUsers, useMembershipHistory } from '../../api/hooks';
import { QueryBoundary } from '../../components/EmptyState';
import { UserAvatar } from '../../components/UserAvatar';
import { fmtDate, TZ, toVN } from '../../lib/date';
import { useAuth } from '../auth/authStore';

export function ProjectMembers({ projectKey, canManage }: { projectKey: string; canManage: boolean }) {
  const { data = [], isLoading, error, refetch } = useMembershipHistory(projectKey);
  const { data: users = [] } = useAllUsers();
  const [form] = Form.useForm<{ userId: number; role: ProjectRole; joinedAt: Dayjs }>();
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
    await Promise.all([qc.invalidateQueries({ queryKey: ['members', projectKey] }), qc.invalidateQueries({ queryKey: ['projects'] }), qc.invalidateQueries({ queryKey: ['project', projectKey] }), reload()]);
  };

  async function leave() {
    if (!leaving || !leftDate || saving) return;
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
    {canManage && <Form form={form} layout="inline" initialValues={{ role: 'developer', joinedAt: today }}
      style={{ marginBottom: 16, gap: 8 }} disabled={saving} onFinish={async (values) => {
        if (saving) return;
        setSaving(true);
        try {
          await addProjectMember(projectKey, { userId: values.userId, role: values.role, joinedAt: values.joinedAt.format('YYYY-MM-DD') });
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
        <Select style={{ width: 130 }} options={PROJECT_ROLES.map((r) => ({ value: r, label: r }))} />
      </Form.Item>
      <Form.Item name="joinedAt" label="Ngày tham gia" rules={[{ required: true, message: 'Chọn ngày tham gia' }]}>
        <DatePicker format="DD/MM/YYYY" maxDate={today} />
      </Form.Item>
      <Form.Item><Button type="primary" htmlType="submit" icon={<PlusOutlined />} loading={saving}>Thêm thành viên</Button></Form.Item>
    </Form>}
    <QueryBoundary isLoading={isLoading} error={error} refetch={refetch}>
      <ListTable<MemberRow> rowKey="id" dataSource={data} scroll={{ x: 964 }} resetKey={projectKey} columns={[
        { title: 'Thành viên', render: (_, m) => <UserAvatar user={m.user} showName /> },
        { title: 'Email', render: (_, m) => m.user.email },
        { title: 'Vai trò', render: (_, m) => canManage && !m.leftAt ? <Select size="small" style={{ width: 130 }} value={m.role}
          aria-label={`Vai trò của ${m.user.displayName}`} disabled={saving || changing !== null} loading={changing === m.id}
          options={PROJECT_ROLES.map((r) => ({ value: r, label: r }))} onChange={async (role: ProjectRole) => {
            setChanging(m.id);
            try { await updateProjectMember(projectKey, String(m.userId), { role }); }
            catch (e) { message.error(errorMessage(e)); setChanging(null); return; }
            try { await refresh(); } catch { message.warning('Đã lưu. Vui lòng tải lại trang.'); }
            finally { setChanging(null); }
          }} /> : <Tag>{m.role}</Tag> },
        { title: 'Ngày tham gia dự án', dataIndex: 'joinedAt', render: fmtDate },
        { title: 'Ngày rời dự án', dataIndex: 'leftAt', render: fmtDate },
        { title: 'Trạng thái', render: (_, m) => <Tag color={m.leftAt ? 'default' : 'green'}>{m.leftAt ? 'Đã rời' : 'Đang tham gia'}</Tag> },
        ...(canManage ? [{ title: 'Thao tác', render: (_: unknown, m: MemberRow) => !m.leftAt ? <ActionIconButton label="Rời dự án" icon={<LogoutOutlined />} danger disabled={saving || changing !== null}
          onClick={() => { setLeaving(m); setLeftDate(today); }} /> : null }] : []),
      ]} />
    </QueryBoundary>
    <Modal title="Ghi nhận rời dự án" open={!!leaving} onCancel={() => { if (!saving) setLeaving(null); }} onOk={leave}
      okText="Xác nhận rời dự án" cancelText="Hủy" confirmLoading={saving} okButtonProps={{ danger: true, disabled: !leftDate }}
      cancelButtonProps={{ disabled: saving }} closable={!saving} maskClosable={!saving} keyboard={!saving}>
      <Space direction="vertical" style={{ width: '100%' }}>
        <span>Quyền thành viên của {leaving?.user.displayName} sẽ được thu hồi. Lịch sử tham gia được giữ lại.</span>
        <label htmlFor="member-left-date">Ngày rời dự án</label>
        <DatePicker id="member-left-date" value={leftDate} onChange={setLeftDate} format="DD/MM/YYYY" disabled={saving}
          minDate={leaving ? toVN(leaving.joinedAt)!.startOf('day') : undefined} maxDate={today} style={{ width: '100%' }} />
      </Space>
    </Modal>
  </Card>;
}
