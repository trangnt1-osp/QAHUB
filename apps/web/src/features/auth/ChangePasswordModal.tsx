import { App, Form, Input, Modal } from 'antd';
import { useState } from 'react';
import { changePassword } from '../../api/generated/api';
import { errorMessage } from '../../api/http';

export function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const { message } = App.useApp();
  return (
    <Modal maskClosable={false} title="Đổi mật khẩu" open={open} onCancel={onClose} onOk={() => form.submit()} confirmLoading={saving} okText="Lưu" cancelText="Hủy" destroyOnClose>
      <Form form={form} layout="vertical" onFinish={async (v) => {
        setSaving(true);
        try { await changePassword({ currentPassword: v.currentPassword, newPassword: v.newPassword }); message.success('Đã đổi mật khẩu'); onClose(); form.resetFields(); }
        catch (e) { message.error(errorMessage(e)); } finally { setSaving(false); }
      }}>
        <Form.Item name="currentPassword" label="Mật khẩu hiện tại" rules={[{ required: true }]}><Input.Password /></Form.Item>
        <Form.Item name="newPassword" label="Mật khẩu mới" rules={[{ required: true, min: 8, message: 'Tối thiểu 8 ký tự' }]}><Input.Password /></Form.Item>
        <Form.Item name="confirm" label="Nhập lại" dependencies={['newPassword']} rules={[{ required: true }, ({ getFieldValue }) => ({ validator: (_, v) => (!v || getFieldValue('newPassword') === v ? Promise.resolve() : Promise.reject(new Error('Mật khẩu nhập lại không khớp'))) })]}><Input.Password /></Form.Item>
      </Form>
    </Modal>
  );
}
