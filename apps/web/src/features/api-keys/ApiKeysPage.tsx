import { CopyOutlined, PlusOutlined } from '@ant-design/icons';
import { Alert, App, Button, Checkbox, Form, Input, Modal, Popconfirm, Radio, Select, Space, Tag, Typography } from 'antd';
import { ListTable } from '../../components/ListTable';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { API_KEY_SCOPES } from '@ospm/shared';
import { createApiKey, listApiKeys, revokeApiKey } from '../../api/generated/api';
import { errorMessage } from '../../api/http';
import { QueryBoundary } from '../../components/EmptyState';
import { fmtDateTime } from '../../lib/date';
import { useAuth } from '../auth/authStore';

const STATUS: Record<string, { color: string; text: string }> = { active: { color: 'success', text: 'Đang dùng' }, expired: { color: 'warning', text: 'Hết hạn' }, revoked: { color: 'default', text: 'Đã thu hồi' } };

export function ApiKeysPage() {
  const isAdmin = useAuth((s) => s.isSystemAdmin());
  const projects = useAuth((s) => s.projects).filter((p) => isAdmin || p.role === 'admin');
  const [sp, setSp] = useSearchParams();
  const projectKey = sp.get('project') ?? projects[0]?.projectKey;
  const { data = [], isLoading, error, refetch } = useQuery<any[]>({ queryKey: ['api-keys', projectKey], queryFn: () => listApiKeys(projectKey!), enabled: !!projectKey });
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<{ key: string; name: string } | null>(null);
  const [form] = Form.useForm();
  const qc = useQueryClient();
  const { message } = App.useApp();

  return (
    <div className="page">
      <Space style={{ marginBottom: 12, width: '100%', justifyContent: 'space-between' }}>
        <Select style={{ width: 260 }} value={projectKey} onChange={(v) => setSp({ project: v })} options={projects.map((p) => ({ value: p.projectKey, label: `${p.projectKey} — ${p.projectName}` }))} />
        <Button type="primary" icon={<PlusOutlined />} disabled={!projectKey} onClick={() => setOpen(true)}>Tạo API key</Button>
      </Space>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Mỗi key gắn với một dự án, có scope và hạn dùng. Repo Playwright đặt key vào biến môi trường APP_API_KEY trong CI." />
      <QueryBoundary isLoading={isLoading} error={error} refetch={refetch} empty={!data.length} emptyTitle="Chưa có API key nào">
        <ListTable rowKey="id" dataSource={data} resetKey={projectKey} style={{ background: '#fff' }} columns={[
          { title: 'Tên', dataIndex: 'name' },
          { title: 'Prefix', dataIndex: 'prefix', render: (p) => <code>{p}…</code> },
          { title: 'Scope', dataIndex: 'scopes', render: (s: string[]) => s.map((x) => <Tag key={x}>{x}</Tag>) },
          { title: 'Người tạo', dataIndex: ['createdBy', 'displayName'] },
          { title: 'Ngày tạo', dataIndex: 'createdAt', render: fmtDateTime },
          { title: 'Dùng gần nhất', dataIndex: 'lastUsedAt', render: (v, k: any) => (v ? `${fmtDateTime(v)}${k.lastUsedIp ? ` · ${k.lastUsedIp}` : ''}` : '—') },
          { title: 'Hết hạn', dataIndex: 'expiresAt', render: (v) => (v ? fmtDateTime(v) : 'Không hết hạn') },
          { title: 'Trạng thái', dataIndex: 'status', render: (s) => <Tag color={STATUS[s].color}>{STATUS[s].text}</Tag> },
          { title: '', render: (_, k: any) => k.status === 'active' && (
            <Popconfirm title="Thu hồi API key này? CI đang dùng key sẽ bị từ chối." okText="Thu hồi" cancelText="Hủy" okButtonProps={{ danger: true }} onConfirm={async () => { try { await revokeApiKey(k.id); await qc.invalidateQueries({ queryKey: ['api-keys'] }); } catch (e) { message.error(errorMessage(e)); } }}>
              <a style={{ color: '#f5222d' }}>Thu hồi</a>
            </Popconfirm>
          ) },
        ]} />
      </QueryBoundary>

      <Modal title="Tạo API key" open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} okText="Tạo" cancelText="Hủy" destroyOnClose>
        <Form form={form} layout="vertical" initialValues={{ scopes: ['runs:write'], days: 90 }} onFinish={async (v) => {
          try {
            const r = await createApiKey(projectKey!, { name: v.name, scopes: v.scopes, expiresAt: v.days ? dayjs().add(v.days, 'day').toISOString() : undefined });
            setCreated({ key: r.key, name: r.name }); setOpen(false); form.resetFields(); await qc.invalidateQueries({ queryKey: ['api-keys'] });
          } catch (e) { message.error(errorMessage(e)); }
        }}>
          <Form.Item name="name" label="Tên" rules={[{ required: true }]}><Input placeholder="GitLab CI - nightly" /></Form.Item>
          <Form.Item name="scopes" label="Scope"><Checkbox.Group options={API_KEY_SCOPES.map((s) => ({ value: s, label: s }))} /></Form.Item>
          <Form.Item name="days" label="Hạn dùng"><Radio.Group options={[{ value: 30, label: '30 ngày' }, { value: 90, label: '90 ngày' }, { value: 365, label: '365 ngày' }, { value: 0, label: 'Không hết hạn' }]} /></Form.Item>
        </Form>
      </Modal>

      <Modal title="API key đã tạo" open={!!created} onCancel={() => setCreated(null)} footer={<Button type="primary" onClick={() => setCreated(null)}>Tôi đã lưu key</Button>} width={640} maskClosable={false}>
        {created && (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Alert type="warning" showIcon message="Key chỉ hiển thị một lần" description="Hãy sao chép và lưu vào biến bí mật của CI ngay bây giờ. Hệ thống chỉ lưu hash nên không thể xem lại." />
            <Input.Group compact style={{ display: 'flex' }}>
              <Input readOnly value={created.key} style={{ fontFamily: 'monospace' }} />
              <Button icon={<CopyOutlined />} onClick={() => { void navigator.clipboard.writeText(created.key); message.success('Đã sao chép'); }}>Copy</Button>
            </Input.Group>
            <Typography.Text strong>Biến môi trường trong CI</Typography.Text>
            <pre style={{ background: '#f6f8fa', padding: 8 }}>{`APP_API_URL=${window.location.origin}\nAPP_API_KEY=${created.key}`}</pre>
            <Typography.Text strong>playwright.config.ts (bên repo Playwright)</Typography.Text>
            <pre style={{ background: '#f6f8fa', padding: 8 }}>{`export default defineConfig({\n  reporter: [['list'], ['./reporters/bug-tracker-reporter.ts']],\n});`}</pre>
            <Typography.Text type="secondary">Xem hướng dẫn đầy đủ ở docs/integration/playwright.md và Swagger tại /api/docs.</Typography.Text>
          </Space>
        )}
      </Modal>
    </div>
  );
}
