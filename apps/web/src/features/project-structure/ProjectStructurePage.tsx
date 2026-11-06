import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { App, Button, Form, Input, Modal, Select, Space, Tabs, Tag } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { errorMessage } from '../../api/http';
import { ActionIconButton } from '../../components/ActionIconButton';
import { ErrorState } from '../../components/EmptyState';
import { ListTable } from '../../components/ListTable';
import { useAuth } from '../auth/authStore';
import { ProjectImportButton } from '../project-import';
import { deleteStructure, getProjectStructure, saveStructure, structureFormValues, type ProjectEpic, type ProjectFunction, type ProjectModule, type StructureKind, type StructureValues } from './api';

type Row = ProjectModule | ProjectFunction | ProjectEpic;
const labels: Record<StructureKind, string> = { epic: 'Epic', module: 'Module', function: 'Function' };
const option = (row: { id: number; code: string; name: string }) => ({ value: row.id, label: `${row.code} · ${row.name}` });
export default function ProjectStructurePage() {
  const { projectKey } = useParams();
  const { hasPermission } = useAuth();
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  const [kind, setKind] = useState<StructureKind>('module');
  const [editing, setEditing] = useState<{ kind: StructureKind; row?: Row }>();
  const [saving, setSaving] = useState(false);
  const [formReady, setFormReady] = useState(false);
  const [form] = Form.useForm<StructureValues>();
  const query = useQuery({ queryKey: ['project-structure-management', projectKey], queryFn: () => getProjectStructure(projectKey!, true), enabled: !!projectKey && hasPermission(projectKey, 'project.structure.view'), staleTime: 0 });
  const data = query.data ?? { modules: [], functions: [], epics: [] };
  const canCreate = hasPermission(projectKey, 'requirement.create');
  const canEdit = hasPermission(projectKey, 'requirement.edit');
  const canDelete = hasPermission(projectKey, 'requirement.delete');
  const refresh = () => Promise.all([
    ...['project-structure', 'project-structure-management', 'requirements', 'epics', 'backlog', 'board', 'tc-summary'].map((key) => qc.invalidateQueries({ queryKey: [key, projectKey] })),
    qc.invalidateQueries({ queryKey: ['issue'] }),
  ]);
  const open = (row?: Row) => {
    setFormReady(false);
    setEditing({ kind, row });
  };
  const submit = async () => {
    if (!editing || !projectKey || !formReady) return;
    let values: StructureValues;
    try { values = await form.validateFields(); } catch { return; }
    setSaving(true);
    try {
      const id = editing.row && ('requirementId' in editing.row ? editing.row.requirementId : editing.row.id);
      await saveStructure(projectKey, editing.kind, { ...values, code: values.code.trim(), name: values.name.trim() }, id);
      await refresh(); setEditing(undefined); message.success('Đã lưu');
    } catch (error) { message.error(errorMessage(error)); }
    finally { setSaving(false); }
  };
  const remove = (row: Row) => {
    modal.confirm({ title: `Xóa ${labels[kind]} ${row.code}?`, content: kind === 'function' ? 'Xóa Function cũng sẽ xóa mềm toàn bộ test case thuộc Function này và cần quyền xóa test case nếu còn dữ liệu. Không thể xóa khi Function còn liên kết với item.' : 'Không thể xóa khi dữ liệu còn được liên kết. Các liên kết hiện có sẽ được kiểm tra trước khi xóa.', okText: 'Xóa', okButtonProps: { danger: true }, cancelText: 'Hủy', onOk: async () => {
      try { await deleteStructure(projectKey!, kind, 'requirementId' in row ? row.requirementId : row.id); await refresh(); message.success('Đã xóa'); }
      catch (error) { message.error(errorMessage(error)); throw error; }
    } });
  };
  const tags = (ids: number[], rows: { id: number; code: string; name: string }[]) => ids.map((id) => { const row = rows.find((item) => item.id === id); return <Tag key={id} title={row?.name}>{row?.code ?? String(id)}</Tag>; });
  const scope = (row: Row) => {
    if ('requirementId' in row) return <Space wrap>{tags(row.moduleIds, data.modules)}{tags(row.functionIds, data.functions)}</Space>;
    if ('epicIds' in row) return <Space wrap>{row.moduleId ? tags([row.moduleId], data.modules) : <Tag>Chưa phân Module</Tag>}{tags(row.epicIds, data.epics.map((epic) => ({ ...epic, id: epic.requirementId })))}</Space>;
    return row.description || '—';
  };
  const related = (row: Row) => <Space wrap>
    {kind !== 'function' && hasPermission(projectKey, 'project.backlog.view') && <Link to={`/projects/${projectKey}/backlog?${kind === 'epic' ? 'epicId' : 'moduleId'}=${row.id}`}>Backlog</Link>}
    {kind !== 'epic' && hasPermission(projectKey, 'testcase.view') && <Link to={`/projects/${projectKey}/test-cases?${kind === 'function' ? 'functionId' : 'moduleId'}=${row.id}`}>Test cases</Link>}
  </Space>;
  if (query.error) return <ErrorState error={query.error} onRetry={query.refetch} />;
  return <div className="page">
    <Tabs activeKey={kind} onChange={(key) => setKind(key as StructureKind)} items={(['module', 'epic', 'function'] as const).map((key) => ({ key, label: labels[key] }))} tabBarExtraContent={<Space wrap><ProjectImportButton projectKey={projectKey!} scope="structure" templateKind={kind} canImport={hasPermission(projectKey, 'project.structure.import')} />{canCreate && <Button type="primary" icon={<PlusOutlined />} onClick={() => open()}>Thêm {labels[kind]}</Button>}</Space>} />
    <ListTable<Row> rowKey="id" resetKey={`${projectKey}-${kind}`} loading={query.isLoading} dataSource={kind === 'epic' ? data.epics : kind === 'module' ? data.modules : data.functions} columns={[
      { title: 'Mã', dataIndex: 'code', width: 180 },
      { title: 'Tên', dataIndex: 'name' },
      { title: kind === 'module' ? 'Mô tả' : 'Phạm vi', key: 'scope', render: (_: unknown, row: Row) => scope(row) },
      { title: 'Liên quan', key: 'related', render: (_: unknown, row: Row) => related(row) },
      ...((canEdit || canDelete) ? [{ title: 'Thao tác', key: 'actions', width: 100, render: (_: unknown, row: Row) => <Space>{canEdit && <ActionIconButton label={`Sửa ${labels[kind]}`} icon={<EditOutlined />} onClick={() => open(row)} />}{canDelete && <ActionIconButton label={`Xóa ${labels[kind]}`} icon={<DeleteOutlined />} danger onClick={() => remove(row)} />}</Space> }] : []),
    ]} />
    <Modal maskClosable={false} title={`${editing?.row ? 'Sửa' : 'Thêm'} ${labels[editing?.kind ?? kind]}`} open={!!editing} onCancel={() => { if (!saving) setEditing(undefined); }} onOk={submit} confirmLoading={saving} okButtonProps={{ disabled: !formReady }} afterOpenChange={(opened) => {
      if (opened && editing) {
        form.resetFields();
        form.setFieldsValue(structureFormValues(editing.row));
        setFormReady(true);
      }
    }} okText="Lưu" cancelText="Hủy" destroyOnClose>
      <Form form={form} layout="vertical" preserve={false} disabled={!formReady || saving}>
        <Form.Item name="code" label="Mã" rules={[{ required: true, whitespace: true, message: 'Nhập mã' }]}><Input /></Form.Item>
        <Form.Item name="name" label="Tên" rules={[{ required: true, whitespace: true, message: 'Nhập tên' }]}><Input /></Form.Item>
        {editing?.kind === 'module' && <Form.Item name="description" label="Mô tả"><Input.TextArea rows={3} /></Form.Item>}
        {editing?.kind === 'function' && <>
          <Form.Item name="moduleId" label="Module"><Select allowClear showSearch optionFilterProp="label" placeholder="Chưa phân Module" options={data.modules.map(option)} /></Form.Item>
          <Form.Item name="epicIds" label="Epics"><Select mode="multiple" showSearch optionFilterProp="label" options={data.epics.map((epic) => ({ ...option(epic), value: epic.requirementId }))} /></Form.Item>
        </>}
        {editing?.kind === 'epic' && <>
          <Form.Item name="moduleIds" label="Modules"><Select mode="multiple" showSearch optionFilterProp="label" options={data.modules.map(option)} /></Form.Item>
          <Form.Item name="functionIds" label="Functions"><Select mode="multiple" showSearch optionFilterProp="label" options={data.functions.map(option)} /></Form.Item>
        </>}
      </Form>
    </Modal>
  </div>;
}
