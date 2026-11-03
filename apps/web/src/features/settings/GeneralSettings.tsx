import { ArrowDownOutlined, ArrowUpOutlined } from '@ant-design/icons';
import { App, Button, Card, Form, Input, List, Popconfirm, Space, Switch } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { createTestCategory, deleteTestCategory, getProject, updateProject, updateProjectSettings, updateTestCategory } from '../../api/generated/api';
import { errorMessage } from '../../api/http';
import { useTestCategories } from '../../api/hooks';
import { UserSelect } from '../../components/UserSelect';
import { NumberedList } from '../../components/NumberedList';
import { ProjectDateFields, projectDateInitialValues, projectDatePayload } from '../projects/ProjectDateFields';

export function GeneralSettings() {
  const { projectKey = '' } = useParams();
  const { data: project } = useQuery<any>({ queryKey: ['project', projectKey], queryFn: () => getProject(projectKey) });
  const { data: cats = [] } = useTestCategories(projectKey);
  const [form] = Form.useForm();
  const [newCat, setNewCat] = useState('');
  const qc = useQueryClient();
  const { message } = App.useApp();
  useEffect(() => { if (project) form.setFieldsValue({ name: project.name, description: project.description, leadId: project.lead?.id, ...projectDateInitialValues(project) }); }, [project, form]);
  const refreshCats = () => qc.invalidateQueries({ queryKey: ['test-categories', projectKey] });
  const move = async (i: number, d: -1 | 1) => {
    const a = cats[i], b = cats[i + d];
    if (!a || !b) return;
    try { await updateTestCategory(projectKey, String(a.id), { position: b.position }); await updateTestCategory(projectKey, String(b.id), { position: a.position }); await refreshCats(); } catch (e) { message.error(errorMessage(e)); }
  };
  return (
    <Space direction="vertical" size="large" style={{ width: '100%', maxWidth: 720 }}>
      <Card title="Thông tin dự án">
        <Form form={form} layout="vertical" onFinish={async (v) => { try { await updateProject(projectKey, { name: v.name, description: v.description, leadId: v.leadId ?? null, ...projectDatePayload(v) }); message.success('Đã lưu'); await qc.invalidateQueries(); } catch (e) { message.error(errorMessage(e)); } }}>
          <Form.Item name="name" label="Tên" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="description" label="Mô tả"><Input.TextArea rows={2} /></Form.Item>
          <Form.Item name="leadId" label="Lead"><UserSelect projectKey={projectKey} onChange={() => undefined} /></Form.Item>
          <ProjectDateFields />
          <Button type="primary" htmlType="submit">Lưu</Button>
        </Form>
      </Card>
      <Card title="Test tự động">
        <Space>
          <Switch checked={!!project?.settings?.createBugForFlaky} onChange={async (v) => { try { await updateProjectSettings(projectKey, { createBugForFlaky: v }); await qc.invalidateQueries({ queryKey: ['project', projectKey] }); } catch (e) { message.error(errorMessage(e)); } }} />
          <span>Tạo bug cho test flaky (pass sau retry)</span>
        </Space>
      </Card>
      <Card title="Category test case">
        <NumberedList rowKey="id" size="small" dataSource={cats} resetKey={projectKey} renderItem={(c, i) => (
          <List.Item actions={[
            <Button key="u" size="small" icon={<ArrowUpOutlined />} disabled={i === 0} onClick={() => move(i, -1)} />,
            <Button key="d" size="small" icon={<ArrowDownOutlined />} disabled={i === cats.length - 1} onClick={() => move(i, 1)} />,
            <Popconfirm key="x" title="Xóa category? Test case sẽ về chưa phân loại." okButtonProps={{ danger: true }} onConfirm={async () => { await deleteTestCategory(projectKey, String(c.id)); await refreshCats(); }}><a style={{ color: '#f5222d' }}>Xóa</a></Popconfirm>,
          ]}>
            <Space><span aria-label="STT" className="muted">{i + 1}.</span><Input.Search size="small" defaultValue={c.name} enterButton="Lưu" style={{ width: 260 }} onSearch={async (v) => { try { await updateTestCategory(projectKey, String(c.id), { name: v }); await refreshCats(); } catch (e) { message.error(errorMessage(e)); } }} /></Space>
          </List.Item>
        )} />
        <Space style={{ marginTop: 8 }}>
          <Input placeholder="Category mới" value={newCat} onChange={(e) => setNewCat(e.target.value)} />
          <Button disabled={!newCat.trim()} onClick={async () => { try { await createTestCategory(projectKey, { name: newCat }); setNewCat(''); await refreshCats(); } catch (e) { message.error(errorMessage(e)); } }}>Thêm</Button>
        </Space>
      </Card>
    </Space>
  );
}
