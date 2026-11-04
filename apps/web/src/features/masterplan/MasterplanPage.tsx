import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { App, Button, Card, Col, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Progress, Row, Select, Space, Statistic, Tag, Typography } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs, { type Dayjs } from 'dayjs';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { errorMessage, http } from '../../api/http';
import { ActionIconButton } from '../../components/ActionIconButton';
import { QueryBoundary } from '../../components/EmptyState';
import { ListTable } from '../../components/ListTable';
import { UserAvatar } from '../../components/UserAvatar';
import { fmtDate } from '../../lib/date';
import { usePermission } from '../auth/authStore';
import './MasterplanPage.css';

type Status = 'planned' | 'in_progress' | 'completed' | 'on_hold';
type Owner = { id: number; displayName: string; avatarUrl?: string | null };
type Feature = { id: number; code: string; name: string };
type Milestone = {
  id: number; name: string; startDate: string | null; endDate: string | null; ownerId: number | null;
  owner: Owner | null; features: Feature[]; acceptanceCriteria: string | null; notes: string | null;
  status: Status; progress: number; version: number;
};
type FormValues = { name: string; range?: [Dayjs | null, Dayjs | null]; ownerId?: number | null; featureIds?: number[]; acceptanceCriteria?: string; notes?: string; status: Status; progress: number };
const statuses = [
  { value: 'planned', label: 'Chưa bắt đầu', color: 'default' },
  { value: 'in_progress', label: 'Đang thực hiện', color: 'blue' },
  { value: 'completed', label: 'Hoàn thành', color: 'green' },
  { value: 'on_hold', label: 'Tạm dừng', color: 'orange' },
] as const;
const overdue = (row: Milestone) => row.status !== 'completed' && !!row.endDate && dayjs(row.endDate).endOf('day').isBefore(dayjs());

export default function MasterplanPage() {
  const { projectKey = '' } = useParams();
  return <ProjectMasterplan key={projectKey} projectKey={projectKey} />;
}

function ProjectMasterplan({ projectKey }: { projectKey: string }) {
  const canEdit = usePermission(projectKey, 'project.info.edit');
  const base = `/api/v1/projects/${encodeURIComponent(projectKey)}/masterplan`;
  const queryKey = ['masterplan', projectKey];
  const qc = useQueryClient();
  const { message } = App.useApp();
  const query = useQuery({ queryKey, queryFn: async () => (await http.get<Milestone[]>(base)).data });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string>();
  const [editor, setEditor] = useState<{ row?: Milestone }>();
  const [deleting, setDeleting] = useState<number>();
  const rows = query.data ?? [];
  const filtered = rows.filter(row => (!status || (status === 'overdue' ? overdue(row) : row.status === status)) && `${row.name} ${row.features.map(feature => `${feature.code} ${feature.name}`).join(' ')}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const refresh = () => qc.invalidateQueries({ queryKey });
  return <div className="page masterplan-page">
    <div className="masterplan-heading">
      <div><Typography.Title level={4} style={{ margin: 0 }}>Masterplan</Typography.Title><Typography.Text type="secondary">Các mốc bàn giao và kế hoạch thực hiện của dự án</Typography.Text></div>
      {canEdit && <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditor({})}>Thêm mốc</Button>}
    </div>
    <QueryBoundary isLoading={query.isLoading} error={query.error} refetch={query.refetch}>
      <Row gutter={[16, 12]} style={{ marginBottom: 20 }}>
        {[
          { label: 'Tổng mốc', count: rows.length },
          { label: 'Đang thực hiện', count: rows.filter(row => row.status === 'in_progress').length },
          { label: 'Đã hoàn thành', count: rows.filter(row => row.status === 'completed').length },
          { label: 'Mốc quá hạn', count: rows.filter(overdue).length, color: '#cf1322' },
        ].map(item => <Col xs={12} lg={6} key={item.label}><Card size="small"><Statistic title={item.label} value={item.count} valueStyle={{ fontSize: 24, color: item.color }} /></Card></Col>)}
      </Row>
      <Card size="small">
        <div className="masterplan-filters">
          <Input.Search aria-label="Tìm mốc kế hoạch" placeholder="Tìm mốc, mã hoặc tên tính năng" value={search} onChange={event => setSearch(event.target.value)} allowClear style={{ width: 300, maxWidth: '100%' }} />
          <Select aria-label="Lọc trạng thái mốc" allowClear placeholder="Tất cả trạng thái" value={status} onChange={setStatus} style={{ width: 190 }} options={[...statuses, { value: 'overdue', label: 'Quá hạn' }]} />
          <Typography.Text type="secondary" className="masterplan-progress-note">Tiến độ được cập nhật thủ công</Typography.Text>
        </div>
        <ListTable<Milestone> rowKey="id" resetKey={`${projectKey}:${search}:${status}`} dataSource={filtered} scroll={{ x: 1150 }}
          locale={{ emptyText: rows.length ? 'Không có mốc phù hợp' : 'Chưa có mốc kế hoạch' }} columns={[
            { title: 'Mốc bàn giao', dataIndex: 'name', width: 260, render: (name: string, row) => <div><Typography.Text strong>{name}</Typography.Text>{row.acceptanceCriteria && <Typography.Paragraph type="secondary" ellipsis={{ rows: 2, tooltip: row.acceptanceCriteria }} style={{ margin: '4px 0 0', fontSize: 12 }}>{row.acceptanceCriteria}</Typography.Paragraph>}{row.notes && <Typography.Paragraph type="secondary" ellipsis={{ rows: 2, tooltip: row.notes }} style={{ margin: '4px 0 0', fontSize: 12 }}>Ghi chú: {row.notes}</Typography.Paragraph>}</div> },
            { title: 'Thời gian dự kiến', width: 190, render: (_, row) => <Space direction="vertical" size={2}><span><span className="muted">Từ </span>{fmtDate(row.startDate)}</span><span><span className="muted">Đến </span>{fmtDate(row.endDate)}</span></Space> },
            { title: 'Tính năng', width: 200, render: (_, row) => row.features.length ? <Space wrap size={[0, 4]}>{row.features.map(feature => <Tag key={feature.id} title={feature.name}>{feature.code}</Tag>)}</Space> : <Typography.Text type="secondary">—</Typography.Text> },
            { title: 'Phụ trách', width: 160, render: (_, row) => row.owner ? <UserAvatar user={row.owner} showName /> : '—' },
            { title: 'Trạng thái', width: 160, render: (_, row) => <Space direction="vertical" size={4}><Tag color={statuses.find(item => item.value === row.status)?.color}>{statuses.find(item => item.value === row.status)?.label}</Tag>{overdue(row) && <Tag color="red">Quá hạn</Tag>}</Space> },
            { title: 'Tiến độ', width: 150, render: (_, row) => <Progress percent={row.progress} size="small" status={row.status === 'completed' ? 'success' : 'normal'} /> },
            ...(canEdit ? [{ title: 'Thao tác', width: 90, render: (_: unknown, row: Milestone) => <Space size={0}>
              <ActionIconButton label={`Sửa mốc ${row.name}`} icon={<EditOutlined />} onClick={() => setEditor({ row })} />
              <Popconfirm title={`Xóa mốc “${row.name}”?`} description="Các tính năng liên quan vẫn được giữ nguyên." okText="Xóa" cancelText="Hủy" onConfirm={async () => {
                if (deleting !== undefined) return;
                setDeleting(row.id);
                try { await http.delete(`${base}/${row.id}`, { params: { version: row.version } }); message.success('Đã xóa mốc kế hoạch'); await refresh(); }
                catch (error) { message.error(errorMessage(error)); void refresh(); } finally { setDeleting(undefined); }
              }}><ActionIconButton label={`Xóa mốc ${row.name}`} danger icon={<DeleteOutlined />} loading={deleting === row.id} disabled={deleting !== undefined} /></Popconfirm>
            </Space> }] : []),
          ]} />
      </Card>
    </QueryBoundary>
    {canEdit && editor && <MilestoneEditor base={base} row={editor.row} onClose={() => setEditor(undefined)} onSaved={refresh} />}
  </div>;
}

function MilestoneEditor({ base, row, onClose, onSaved }: { base: string; row?: Milestone; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const [form] = Form.useForm<FormValues>();
  const [saving, setSaving] = useState(false);
  const { message } = App.useApp();
  const options = useQuery({ queryKey: ['masterplan-options', base], queryFn: async () => (await http.get<{ owners: Owner[]; features: Feature[] }>(`${base}/options`)).data });
  const owners = new Map((options.data?.owners ?? []).map(owner => [owner.id, owner]));
  if (row?.owner) owners.set(row.owner.id, row.owner);
  const features = new Map((options.data?.features ?? []).map(feature => [feature.id, feature]));
  row?.features.forEach(feature => features.set(feature.id, feature));
  const selectedStatus = Form.useWatch('status', form);
  return <Modal open title={row ? 'Sửa mốc kế hoạch' : 'Thêm mốc kế hoạch'} width={760} onCancel={() => !saving && onClose()} closable={!saving} maskClosable={!saving} keyboard={!saving}
    okText="Lưu" cancelText="Hủy" confirmLoading={saving} onOk={() => form.submit()} cancelButtonProps={{ disabled: saving }}>
    <Form form={form} layout="vertical" disabled={saving} initialValues={row ? { ...row, range: [row.startDate ? dayjs(row.startDate) : null, row.endDate ? dayjs(row.endDate) : null], featureIds: row.features.map(feature => feature.id) } : { status: 'planned', progress: 0, featureIds: [] }}
      onValuesChange={changed => { if (changed.status === 'completed') form.setFieldValue('progress', 100); }}
      onFinish={async values => {
        if (saving) return;
        setSaving(true);
        const payload = { name: values.name.trim(), startDate: values.range?.[0]?.format('YYYY-MM-DD') ?? null, endDate: values.range?.[1]?.format('YYYY-MM-DD') ?? null, ownerId: values.ownerId ?? null, featureIds: values.featureIds ?? [], acceptanceCriteria: values.acceptanceCriteria?.trim() || null, notes: values.notes?.trim() || null, status: values.status, progress: values.progress };
        try {
          if (row) await http.patch(`${base}/${row.id}`, { ...payload, version: row.version });
          else await http.post(base, payload);
          message.success(row ? 'Đã cập nhật mốc kế hoạch' : 'Đã thêm mốc kế hoạch'); await onSaved(); onClose();
        } catch (error) { message.error(errorMessage(error)); void onSaved(); } finally { setSaving(false); }
      }}>
      <Form.Item name="name" label="Tên mốc" rules={[{ required: true, whitespace: true, message: 'Nhập tên mốc kế hoạch' }, { max: 200 }]}><Input maxLength={200} placeholder="Ví dụ: Bàn giao luồng đăng nhập" /></Form.Item>
      <Row gutter={16}>
        <Col xs={24} sm={14}><Form.Item name="range" label="Thời gian dự kiến"><DatePicker.RangePicker allowEmpty={[true, true]} format="DD/MM/YYYY" style={{ width: '100%' }} /></Form.Item></Col>
        <Col xs={24} sm={10}><Form.Item name="ownerId" label="Người phụ trách"><Select allowClear showSearch optionFilterProp="label" loading={options.isLoading} options={[...owners.values()].map(owner => ({ value: owner.id, label: owner.displayName }))} placeholder="Chọn thành viên dự án" /></Form.Item></Col>
      </Row>
      <Form.Item name="featureIds" label="Tính năng liên quan"><Select mode="multiple" showSearch optionFilterProp="label" loading={options.isLoading} options={[...features.values()].map(feature => ({ value: feature.id, label: `${feature.code} · ${feature.name}` }))} placeholder="Chọn tính năng của dự án" /></Form.Item>
      {options.isError && <Typography.Paragraph type="danger">Không tải được danh sách thành viên/tính năng. <Button type="link" size="small" onClick={() => void options.refetch()}>Thử lại</Button></Typography.Paragraph>}
      <Row gutter={16}>
        <Col xs={24} sm={14}><Form.Item name="status" label="Trạng thái" rules={[{ required: true }]}><Select options={[...statuses]} /></Form.Item></Col>
        <Col xs={24} sm={10}><Form.Item name="progress" label="Tiến độ (%)" rules={[{ required: true, message: 'Nhập tiến độ' }, { type: 'integer', min: 0, max: 100, message: 'Nhập số nguyên từ 0 đến 100' }]}><InputNumber min={0} max={100} precision={0} disabled={saving || selectedStatus === 'completed'} style={{ width: '100%' }} /></Form.Item></Col>
      </Row>
      <Form.Item name="acceptanceCriteria" label="Điều kiện nghiệm thu" rules={[{ max: 8000 }]}><Input.TextArea rows={3} maxLength={8000} placeholder="Điều kiện để xác nhận mốc đã hoàn thành" /></Form.Item>
      <Form.Item name="notes" label="Ghi chú" rules={[{ max: 8000 }]}><Input.TextArea rows={2} maxLength={8000} /></Form.Item>
    </Form>
  </Modal>;
}
