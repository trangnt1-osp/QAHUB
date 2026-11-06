import { fmtNumber } from '../../lib/number';
import { CheckOutlined, DeleteOutlined, EditOutlined, PlayCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { Alert, App, Button, Card, DatePicker, Form, Input, Modal, Progress, Select, Space, Tag, Typography } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { Dayjs } from 'dayjs';
import { deleteSprint } from '../../api/generated/api';
import { errorMessage, http } from '../../api/http';
import type { Sprint } from '../../api/models';
import { ActionIconButton } from '../../components/ActionIconButton';
import { QueryBoundary } from '../../components/EmptyState';
import { ListTable } from '../../components/ListTable';
import { fmtDate } from '../../lib/date';
import { usePermission } from '../auth/authStore';
import { CompleteSprintModal, EditSprintModal, StartSprintModal } from '../backlog/SprintModals';

type Period = Sprint & { issueCount: number; doneCount: number; openCount: number };
type Mode = 'sprint' | 'phase';

export function ProjectPeriods({ projectKey, trackingMode = 'sprint' }: { projectKey: string; trackingMode?: Mode }) {
  const canCreate = usePermission(projectKey, 'period.create');
  const canEdit = usePermission(projectKey, 'period.edit');
  const canDelete = usePermission(projectKey, 'period.delete');
  const canStart = usePermission(projectKey, 'period.start');
  const canComplete = usePermission(projectKey, 'period.complete');
  const canAdmin = usePermission(projectKey, 'project.info.edit');
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [changingMode, setChangingMode] = useState(false);
  const [modeError, setModeError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [selected, setSelected] = useState<{ action: 'edit' | 'start' | 'complete'; period: Period } | null>(null);
  const [form] = Form.useForm<{ name?: string; goal?: string; range?: [Dayjs | null, Dayjs | null] }>();
  const { data: periods = [], isLoading, error, refetch } = useQuery({
    queryKey: ['sprints', projectKey, 'all'],
    staleTime: 0,
    queryFn: async () => (await http.get<Period[]>(`/api/v1/projects/${encodeURIComponent(projectKey)}/sprints`)).data,
  });
  const label = trackingMode === 'phase' ? 'phase' : 'sprint';
  const activeSprint = trackingMode === 'sprint' && periods.some((p) => p.state === 'active');
  const selectedPeriod = selected ? periods.find((p) => p.id === selected.period.id) ?? selected.period : null;
  return <Card title="Quản lý Sprint / Phase" extra={canCreate && <Button icon={<PlusOutlined />} onClick={() => { form.resetFields(); setCreating(true); }}>Tạo {label}</Button>}>
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Space wrap>
        <Typography.Text>Chế độ theo dõi:</Typography.Text>
        <Select aria-label="Chế độ theo dõi" value={trackingMode} disabled={!canAdmin || changingMode} loading={changingMode} style={{ width: 130 }}
          options={[{ value: 'sprint', label: 'Sprint' }, { value: 'phase', label: 'Phase' }]} onChange={async (mode: Mode) => {
            setChangingMode(true); setModeError(null);
            try { await http.patch(`/api/v1/projects/${encodeURIComponent(projectKey)}`, { trackingMode: mode }); await qc.invalidateQueries(); message.success('Đã đổi chế độ theo dõi'); }
            catch (e) { setModeError(errorMessage(e)); } finally { setChangingMode(false); }
          }} />
      </Space>
      <Typography.Text type="secondary">Chỉ quản trị viên được đổi chế độ khi dự án không có item được phân bổ và không có Sprint / Phase đang hoạt động.</Typography.Text>
      {modeError && <Alert type="error" showIcon message={modeError} />}
      <QueryBoundary isLoading={isLoading} error={error} refetch={refetch}>
        <ListTable<Period> rowKey="id" resetKey={`${projectKey}:${trackingMode}`} dataSource={periods} scroll={{ x: 1000 }} columns={[
          { title: 'Tên', dataIndex: 'name', width: 180 },
          { title: 'Mục tiêu', dataIndex: 'goal', render: (goal: string | null) => goal || '—' },
          { title: 'Ngày bắt đầu', dataIndex: 'startDate', render: fmtDate, width: 130 },
          { title: 'Ngày kết thúc', dataIndex: 'endDate', render: fmtDate, width: 130 },
          { title: 'Trạng thái', dataIndex: 'state', width: 130, render: (state: Sprint['state']) => <Tag color={state === 'active' ? 'blue' : state === 'closed' ? 'green' : 'default'}>{state === 'active' ? 'Đang hoạt động' : state === 'closed' ? 'Đã hoàn thành' : 'Chưa bắt đầu'}</Tag> },
          { title: 'Tiến độ', width: 160, render: (_, p) => <><Typography.Text>{fmtNumber(p.doneCount)} / {fmtNumber(p.doneCount + p.openCount)} item</Typography.Text><Progress size="small" format={(percent) => `${fmtNumber(percent)}%`} percent={p.doneCount + p.openCount ? Math.round(p.doneCount / (p.doneCount + p.openCount) * 100) : 0} /></> },
          ...(canEdit || canStart || canComplete || canDelete ? [{ title: 'Thao tác', width: 150, render: (_: unknown, p: Period) => <Space size={0}>
            {canEdit && <ActionIconButton label={p.state === 'closed' ? `${label} đã hoàn thành` : `Sửa ${label}`} disabled={p.state === 'closed'} icon={<EditOutlined />} onClick={() => setSelected({ action: 'edit', period: p })} />}
            {canStart && p.state === 'future' && <ActionIconButton label={activeSprint ? 'Đã có sprint đang hoạt động' : `Bắt đầu ${label}`} disabled={!!activeSprint} icon={<PlayCircleOutlined />} onClick={() => setSelected({ action: 'start', period: p })} />}
            {canComplete && p.state === 'active' && <ActionIconButton label={`Hoàn thành ${label}`} icon={<CheckOutlined />} onClick={() => setSelected({ action: 'complete', period: p })} />}
            {canDelete && <ActionIconButton label={p.issueCount > 0 ? `Không thể xóa ${label} có item được phân bổ (kể cả item đã xong hoặc đã xóa)` : p.state === 'active' ? `Hoàn thành ${label} trước khi xóa` : `Xóa ${label}`} icon={<DeleteOutlined />} danger disabled={p.issueCount > 0 || p.state === 'active' || deleting !== null} loading={deleting === p.id} onClick={async () => {
                setDeleting(p.id);
                try { await deleteSprint(String(p.id)); await qc.invalidateQueries(); }
                catch (e) { message.error(errorMessage(e)); } finally { setDeleting(null); }
            }} />}
          </Space> }] : []),
        ]} />
      </QueryBoundary>
    </Space>
    <Modal maskClosable={false} title={`Tạo ${label}`} open={canCreate && creating} onCancel={() => { if (!saving) setCreating(false); }} onOk={() => form.submit()} confirmLoading={saving} okText="Tạo" cancelText="Hủy" destroyOnClose>
      <Form form={form} layout="vertical" disabled={saving} onFinish={async (values) => {
        if (saving || !canCreate) return;
        setSaving(true);
        try {
          await http.post(`/api/v1/projects/${encodeURIComponent(projectKey)}/sprints`, { name: values.name?.trim() || undefined, goal: values.goal?.trim() || undefined, startDate: values.range?.[0]?.format('YYYY-MM-DD') ?? null, endDate: values.range?.[1]?.format('YYYY-MM-DD') ?? null });
          await qc.invalidateQueries(); setCreating(false); message.success(`Đã tạo ${label}`);
        } catch (e) { message.error(errorMessage(e)); } finally { setSaving(false); }
      }}>
        <Form.Item name="name" label="Tên"><Input placeholder="Để trống để đặt tên tự động" maxLength={200} /></Form.Item>
        <Form.Item name="goal" label="Mục tiêu"><Input.TextArea rows={3} /></Form.Item>
        <Form.Item name="range" label="Thời gian"><DatePicker.RangePicker allowEmpty={[true, true]} format="DD/MM/YYYY" style={{ width: '100%' }} /></Form.Item>
      </Form>
    </Modal>
    <EditSprintModal sprint={selectedPeriod} open={canEdit && selected?.action === 'edit'} onClose={() => setSelected(null)} />
    <StartSprintModal sprint={selectedPeriod} open={canStart && selected?.action === 'start'} onClose={() => setSelected(null)} />
    <CompleteSprintModal sprint={selectedPeriod} open={canComplete && selected?.action === 'complete'} done={selectedPeriod?.doneCount ?? 0} notDone={selectedPeriod?.openCount ?? 0} futureSprints={periods.filter((p) => p.state === 'future')} onClose={() => setSelected(null)} />
  </Card>;
}
