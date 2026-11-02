import { App, Form, Input, Modal, Select, Switch } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { SYSTEM_ROLES, type SystemRole } from '@ospm/shared';
import { updateUser } from '../../api/generated/api';
import { errorCode, errorMessage } from '../../api/http';
import { useAuth } from '../auth/authStore';

interface EditUserValues {
  displayName: string;
  email: string;
  systemRole: SystemRole;
  isActive: boolean;
}

export type EditableUser = EditUserValues & { id: number };

export function EditUserModal({ user, onClose }: { user: EditableUser; onClose: () => void }) {
  const [form] = Form.useForm<EditUserValues>();
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();
  const { message } = App.useApp();
  const me = useAuth((s) => s.user);
  const reloadMe = useAuth((s) => s.reload);
  const isSelf = user.id === me?.id;

  async function save(values: EditUserValues) {
    if (saving) return;
    setSaving(true);
    try {
      await updateUser(String(user.id), {
        displayName: values.displayName.trim(),
        email: values.email.trim(),
        ...(!isSelf ? { systemRole: values.systemRole, isActive: values.isActive } : {}),
      });
    } catch (e) {
      if (errorCode(e) === 'EMAIL_TAKEN') {
        form.setFields([{ name: 'email', errors: ['Email đã được sử dụng'] }]);
      } else {
        message.error(errorMessage(e));
      }
      setSaving(false);
      return;
    }
    try {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['users'] }),
        qc.invalidateQueries({ queryKey: ['members'] }),
        ...(isSelf ? [reloadMe()] : []),
      ]);
      message.success('Đã cập nhật người dùng');
      onClose();
    } catch {
      message.warning('Đã lưu thay đổi. Vui lòng tải lại trang để cập nhật thông tin.');
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Sửa người dùng" open onCancel={() => { if (!saving) onClose(); }}
      onOk={() => form.submit()} okText="Lưu" cancelText="Hủy" confirmLoading={saving}
      cancelButtonProps={{ disabled: saving }} closable={!saving} maskClosable={!saving} keyboard={!saving}>
      <Form form={form} layout="vertical" initialValues={user} onFinish={save} disabled={saving}>
        <Form.Item name="displayName" label="Tên hiển thị" rules={[{ required: true, whitespace: true, message: 'Vui lòng nhập tên hiển thị' }]}>
          <Input autoFocus />
        </Form.Item>
        <Form.Item name="email" label="Email" rules={[{ required: true, message: 'Vui lòng nhập email' }, { type: 'email', transform: (v: string) => v?.trim(), message: 'Email không hợp lệ' }]}>
          <Input />
        </Form.Item>
        <Form.Item name="systemRole" label="Vai trò hệ thống" rules={[{ required: true }]}>
          <Select disabled={saving || isSelf} options={SYSTEM_ROLES.map((r) => ({ value: r, label: r }))} />
        </Form.Item>
        <Form.Item name="isActive" label="Trạng thái" valuePropName="checked"
          extra={isSelf ? 'Bạn không thể tự khóa hoặc thay đổi vai trò của chính mình.' : undefined}>
          <Switch disabled={saving || isSelf} checkedChildren="Hoạt động" unCheckedChildren="Đã khóa" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
