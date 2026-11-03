import { LockOutlined } from '@ant-design/icons';
import { App, Button, ColorPicker, Input, Popconfirm, Space, Tag } from 'antd';
import { ListTable } from '../../components/ListTable';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { createLabel, deleteLabel, updateLabel } from '../../api/generated/api';
import { errorMessage } from '../../api/http';
import { useLabels } from '../../api/hooks';

export function LabelSettings() {
  const { projectKey = '' } = useParams();
  const { data = [], isLoading } = useLabels(projectKey);
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [name, setName] = useState('');
  const [color, setColor] = useState('#f51d53');
  const refresh = () => qc.invalidateQueries({ queryKey: ['labels', projectKey] });
  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Input placeholder="Tên label mới" value={name} onChange={(e) => setName(e.target.value)} style={{ width: 220 }} />
        <ColorPicker value={color} onChange={(c) => setColor(c.toHexString())} />
        <Button type="primary" disabled={!name.trim()} onClick={async () => { try { await createLabel(projectKey, { name, color }); setName(''); await refresh(); } catch (e) { message.error(errorMessage(e)); } }}>Thêm label</Button>
      </Space>
      <ListTable rowKey="id" loading={isLoading} dataSource={data} resetKey={projectKey} style={{ background: '#fff' }} columns={[
        { title: 'Label', render: (_, l) => <Tag color={l.color}>{l.name}</Tag> },
        { title: 'Tên', dataIndex: 'name', render: (n, l) => l.isSystem ? <span><LockOutlined /> {n} <span className="muted">(hệ thống, bị khóa)</span></span> : <Input.Search size="small" defaultValue={n} enterButton="Lưu" style={{ width: 240 }} onSearch={async (v) => { try { await updateLabel(projectKey, String(l.id), { name: v }); await refresh(); } catch (e) { message.error(errorMessage(e)); } }} /> },
        { title: 'Màu', dataIndex: 'color', render: (c, l) => <ColorPicker size="small" value={c} disabled={l.isSystem} onChangeComplete={async (v) => { try { await updateLabel(projectKey, String(l.id), { color: v.toHexString() }); await refresh(); } catch (e) { message.error(errorMessage(e)); } }} /> },
        { title: '', render: (_, l) => !l.isSystem && <Popconfirm title="Xóa label? Label sẽ bị gỡ khỏi mọi item." okButtonProps={{ danger: true }} onConfirm={async () => { try { await deleteLabel(projectKey, String(l.id)); await refresh(); } catch (e) { message.error(errorMessage(e)); } }}><a style={{ color: '#f5222d' }}>Xóa</a></Popconfirm> },
      ]} />
    </>
  );
}
