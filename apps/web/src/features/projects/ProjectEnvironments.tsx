import { CopyOutlined, DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { App, Button, Col, Empty, Form, Input, Modal, Popconfirm, Row, Select, Space, Table, Tag, Typography } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage, http } from '../../api/http';
import { ActionIconButton } from '../../components/ActionIconButton';
import { QueryBoundary } from '../../components/EmptyState';
import { usePermission } from '../auth/authStore';
import './ProjectEnvironments.css';

const statuses = [{ value: 'active', label: 'Hoạt động' }, { value: 'maintenance', label: 'Bảo trì' }, { value: 'inactive', label: 'Ngừng sử dụng' }];
interface EnvironmentAccount { username: string; password: string; role?: string; notes?: string }
interface Environment {
  id: number; name: string; kind: string; appUrl: string | null; apiUrl: string | null;
  deployedVersion: string | null; ownerId: number | null; accounts?: EnvironmentAccount[];
  status: string; notes: string | null; version: number;
}
const urlRule = { validator: (_: unknown, value?: string) => {
  if (!value?.trim()) return Promise.resolve();
  try { const url = new URL(value.trim()); if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return Promise.resolve(); } catch { /* show validation below */ }
  return Promise.reject(new Error('Nhập URL http:// hoặc https://, không chứa thông tin đăng nhập'));
} };
function EnvironmentAccounts({ accounts, copy }: { accounts: EnvironmentAccount[]; copy: (label: string, value: string) => Promise<void> }) {
  return <div className="environment-accounts">
    <div className="environment-accounts-heading"><Typography.Text strong>Danh sách tài khoản</Typography.Text><span className="environment-accounts-count">{accounts.length}</span></div>
    <Table rowKey="key" size="small" pagination={false} dataSource={accounts.map((account, index) => ({ ...account, key: index }))} scroll={{ x: 560 }}
      locale={{ emptyText: 'Chưa có tài khoản' }} columns={[
        { title: 'Tài khoản', dataIndex: 'username', width: '28%', render: (value: string, _, index) => <div className="environment-account-username"><Typography.Text strong>{value}</Typography.Text><ActionIconButton label={`Sao chép tài khoản ${index + 1}`} icon={<CopyOutlined />} onClick={() => void copy('tài khoản', value)} /></div> },
        { title: 'Mật khẩu', dataIndex: 'password', width: '25%', render: (value: string, _, index) => <Space size={0}><Input.Password variant="borderless" key={`${index}:${value}`} aria-label={`Mật khẩu tài khoản ${index + 1}`} readOnly value={value} autoComplete="off" className="environment-account-password" /><ActionIconButton label={`Sao chép mật khẩu ${index + 1}`} icon={<CopyOutlined />} onClick={() => void copy('mật khẩu', value)} /></Space> },
        { title: 'Vai trò', dataIndex: 'role', width: '17%', render: (value?: string) => value ? <Tag bordered={false} className="environment-account-role">{value}</Tag> : <Typography.Text type="secondary">—</Typography.Text> },
        { title: 'Ghi chú', dataIndex: 'notes', render: (value?: string) => <Typography.Text type="secondary" style={{ whiteSpace: 'pre-wrap' }}>{value || '—'}</Typography.Text> },
      ]} />
  </div>;
}

function AccountFields() {
  return <Form.List name="accounts">{(fields, { add, remove }) => <>
    <div className="environment-accounts-heading"><Typography.Text strong>Danh sách tài khoản</Typography.Text><span className="environment-accounts-count">{fields.length}</span><Button className="environment-account-add" type="text" size="small" icon={<PlusOutlined />} disabled={fields.length >= 50} onClick={() => add({ username: '', password: '', role: '', notes: '' })}>Thêm tài khoản</Button></div>
    {!fields.length && <div className="environment-account-empty">Chưa có tài khoản. Thêm tài khoản để lưu thông tin truy cập môi trường.</div>}
    {fields.map(({ key, name, ...rest }, index) => <div key={key} className="environment-account-editor">
      <div className="environment-account-editor-heading"><Typography.Text type="secondary">Tài khoản {String(index + 1).padStart(2, '0')}</Typography.Text><ActionIconButton label={`Xóa tài khoản ${index + 1}`} danger icon={<DeleteOutlined />} onClick={() => remove(name)} /></div>
      <Row gutter={12}>
        <Col xs={24} sm={6}><Form.Item {...rest} name={[name, 'username']} label={`Tài khoản ${index + 1}`} rules={[{ required: true, whitespace: true, message: 'Nhập tài khoản' }, { max: 200 }]}><Input placeholder="Email hoặc tên đăng nhập" autoComplete="off" /></Form.Item></Col>
        <Col xs={24} sm={6}><Form.Item {...rest} name={[name, 'password']} label={`Mật khẩu ${index + 1}`} rules={[{ max: 2000 }]}><Input.Password placeholder="Nhập mật khẩu" autoComplete="new-password" /></Form.Item></Col>
        <Col xs={24} sm={6}><Form.Item {...rest} name={[name, 'role']} label="Vai trò" rules={[{ max: 100 }]}><Input placeholder="VD: Tester" /></Form.Item></Col>
        <Col xs={24} sm={6}><Form.Item {...rest} name={[name, 'notes']} label="Ghi chú tài khoản" rules={[{ max: 2000 }]}><Input placeholder="Ghi chú truy cập (nếu có)" /></Form.Item></Col>
      </Row>
    </div>)}
  </>}</Form.List>;
}
function EnvironmentDetails({ environment }: { environment: Environment }) {
  const { message } = App.useApp();
  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      message.success(`Đã sao chép ${label}`);
    } catch {
      message.error(`Không thể sao chép ${label}`);
    }
  };
  const linkedValue = (label: string, value: string | null) => value ? <span className="environment-detail-link">
    <Typography.Link href={value} title={value} ellipsis target="_blank" rel="noopener noreferrer">{value}</Typography.Link>
    <ActionIconButton label={`Sao chép ${label}`} icon={<CopyOutlined />} onClick={() => void copy(label, value)} />
  </span> : '—';
  return <div className="environment-content-columns">
    <div className="environment-info-panel">
      <div className="environment-info-heading"><Typography.Text strong>Thông tin môi trường</Typography.Text></div>
      <div className="environment-details-compact">
      <div className="environment-detail"><Typography.Text type="secondary">URL ứng dụng</Typography.Text>{linkedValue('URL ứng dụng', environment.appUrl)}</div>
      <div className="environment-detail"><Typography.Text type="secondary">URL API</Typography.Text>{linkedValue('URL API', environment.apiUrl)}</div>
      <div className="environment-detail"><Typography.Text type="secondary">Phiên bản / Build</Typography.Text>{environment.deployedVersion ? <Space size="small"><Typography.Text>{environment.deployedVersion}</Typography.Text><ActionIconButton label="Sao chép phiên bản / Build" icon={<CopyOutlined />} onClick={() => void copy('phiên bản / Build', environment.deployedVersion!)} /></Space> : <span>—</span>}</div>
      <div className="environment-detail environment-detail-notes"><Typography.Text type="secondary">Ghi chú</Typography.Text><span>{environment.notes || '—'}</span></div>
      </div>
    </div>
    <EnvironmentAccounts accounts={environment.accounts ?? []} copy={copy} />
  </div>;
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
  const [selection, setSelection] = useState<{ projectKey: string; id: number }>();
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const readOnly = editor?.mode === 'view';
  const open = (mode: 'create' | 'view' | 'edit', row?: Environment) => { setReady(false); setEditor({ mode, row }); };
  const refresh = () => qc.invalidateQueries({ queryKey });
  const save = async () => {
    if (!editor || readOnly || !canEdit || saving || !ready) return;
    const values = await form.validateFields().catch(() => null);
    if (!values) return;
    setSaving(true);
    try {
      const payload = { ...values, name: values.name.trim(), appUrl: values.appUrl?.trim() || null, apiUrl: values.apiUrl?.trim() || null, deployedVersion: values.deployedVersion?.trim() || null, notes: values.notes?.trim() || null };
      if (editor.row) await http.patch(`${base}/${editor.row.id}`, { ...payload, version: editor.row.version });
      else await http.post(base, payload);
      message.success(editor.row ? 'Đã cập nhật môi trường' : 'Đã thêm môi trường');
      setEditor(undefined); await refresh();
    } catch (error) { message.error(errorMessage(error)); void refresh(); }
    finally { setSaving(false); }
  };
  const rows = query.data ?? [];
  const selected = rows.find(row => selection?.projectKey === projectKey && row.id === selection.id)
    ?? rows.find(row => row.name.trim().toLowerCase() === 'staging') ?? rows[0];
  return <section aria-label="Môi trường" className="project-environment-compact">
    <Space wrap size={8} style={{ marginBottom: 10 }}>
      <Typography.Text strong>Môi trường</Typography.Text>
      <Select aria-label="Chọn môi trường" showSearch optionFilterProp="label" placeholder="Chọn môi trường" style={{ width: 240, maxWidth: '100%' }}
        value={selected?.id} loading={query.isLoading} options={rows.map(row => ({ value: row.id, label: row.name }))}
        onChange={id => setSelection({ projectKey, id })} />
      {canEdit && <>
        <ActionIconButton label="Sửa môi trường" icon={<EditOutlined />} disabled={!selected} onClick={() => open('edit', selected)} />
        <ActionIconButton label="Thêm môi trường" icon={<PlusOutlined />} onClick={() => open('create')} />
      </>}
      {selected && <Tag color={selected.status === 'active' ? 'green' : selected.status === 'maintenance' ? 'orange' : 'default'}>{statuses.find(item => item.value === selected.status)?.label ?? selected.status}</Tag>}
    </Space>
    <QueryBoundary isLoading={query.isLoading} error={query.error} refetch={query.refetch}>
      {selected ? <EnvironmentDetails key={selected.id} environment={selected} /> : <Empty description="Chưa có môi trường" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
    </QueryBoundary>
    <Modal maskClosable={false} title={readOnly ? 'Thông tin môi trường' : editor?.mode === 'edit' ? 'Sửa môi trường' : 'Thêm môi trường'} open={!!editor} width={720} destroyOnHidden closable={!saving} keyboard={!saving} onCancel={() => !saving && setEditor(undefined)}
      afterOpenChange={visible => { if (visible) { form.resetFields(); form.setFieldsValue(editor?.row ?? { name: 'Staging', status: 'active', accounts: [] }); } setReady(visible); }}
      footer={<Space>{canEdit && editor?.mode === 'edit' && editor.row && <Popconfirm title="Xóa môi trường này?" onConfirm={async () => {
        const row = editor.row!;
        setDeleting(row.id);
        try { await http.delete(`${base}/${row.id}`, { params: { version: row.version } }); setEditor(undefined); await refresh(); }
        catch (error) { message.error(errorMessage(error)); } finally { setDeleting(undefined); }
      }}><ActionIconButton label="Xóa môi trường" danger icon={<DeleteOutlined />} disabled={saving || deleting !== undefined} loading={deleting !== undefined} /></Popconfirm>}<Button disabled={saving} onClick={() => setEditor(undefined)}>{readOnly ? 'Đóng' : 'Hủy'}</Button>{!readOnly && <Button type="primary" onClick={() => void save()} disabled={!ready} loading={saving}>Lưu</Button>}</Space>}>
      {readOnly && editor?.row ? <EnvironmentDetails environment={editor.row} /> : <Form form={form} layout="vertical" disabled={saving || !ready}>
        <Form.Item name="name" label="Tên môi trường" rules={[{ required: true, whitespace: true, message: 'Nhập tên môi trường' }, { max: 100 }]}><Input maxLength={100} placeholder="Ví dụ: UAT khách hàng" /></Form.Item>
        <Form.Item name="appUrl" label="URL ứng dụng" rules={[urlRule, { max: 2000 }]}><Input placeholder="https://uat.example.com" /></Form.Item>
        <Form.Item name="apiUrl" label="URL API" rules={[urlRule, { max: 2000 }]}><Input placeholder="https://api-uat.example.com" /></Form.Item>
        <Row gutter={16}><Col xs={24} sm={12}><Form.Item name="deployedVersion" label="Phiên bản / Build"><Input maxLength={100} placeholder="Ví dụ: v1.2.0 / build-120" /></Form.Item></Col><Col xs={24} sm={12}><Form.Item name="status" label="Trạng thái" rules={[{ required: true }]}><Select options={statuses} /></Form.Item></Col></Row>
        <Form.Item name="notes" label="Ghi chú"><Input.TextArea maxLength={8000} autoSize={{ minRows: 3, maxRows: 8 }} placeholder="Hướng dẫn truy cập, VPN, dữ liệu kiểm thử…" /></Form.Item>
        <AccountFields />
      </Form>}
    </Modal>
  </section>;
}
