import { InfoCircleOutlined, SearchOutlined } from '@ant-design/icons';
import { Button, Checkbox, Collapse, Input, Space, Tag, Tooltip, Typography } from 'antd';
import { useState } from 'react';
import { PERMISSION_CATALOG, togglePermission, type Permission } from '@ospm/shared';
import { EmptyState } from '../../components/EmptyState';
import { fmtNumber } from '../../lib/number';

const areas = [
  { key: 'overview', name: 'Tổng quan', prefixes: ['dashboard.'] },
  { key: 'project', name: 'Dự án', prefixes: ['project.'] },
  { key: 'work', name: 'Công việc', prefixes: ['issue.', 'period.', 'workflow.', 'attachment.'] },
  { key: 'testing', name: 'Kiểm thử', prefixes: ['testcase.', 'requirement.'] },
  { key: 'settings', name: 'Cấu hình', prefixes: ['settings.'] },
  { key: 'integrations', name: 'Tích hợp & báo cáo', prefixes: ['apikey.', 'report.'] },
];
const sections = areas.map((area) => ({ ...area, permissions: PERMISSION_CATALOG.filter((entry) => area.prefixes.some((prefix) => entry.key.startsWith(prefix))) }));
const labels = new Map<Permission, string>(PERMISSION_CATALOG.map((entry) => [entry.key, entry.label]));
const searchText = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim();
const help = 'Bật một thao tác sẽ tự bật quyền cần thiết. Tắt quyền sẽ tắt các thao tác phụ thuộc. Thay đổi chỉ được ghi khi bấm Lưu.';

export function PermissionEditor({ value, onChange, disabled = false }: {
  value: Permission[]; onChange: (value: Permission[]) => void; disabled?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<{ text: string; details: string } | null>(null);
  const visibleSections = (text: string) => sections.map((section) => ({ ...section, visible: section.permissions.filter((entry) => !searchText(text) || searchText(`${section.name} ${entry.group} ${entry.label} ${entry.key}`).includes(searchText(text))) })).filter((section) => section.visible.length);
  const visible = visibleSections(query);
  const allOpen = visible.length > 0 && visible.every((section) => expanded.includes(section.key));

  function toggle(key: Permission, enabled: boolean) {
    if (disabled) return;
    const next = togglePermission(value, key, enabled);
    const automatic = enabled ? next.filter((permission) => permission !== key && !value.includes(permission)) : value.filter((permission) => permission !== key && !next.includes(permission));
    setFeedback({
      text: automatic.length ? `${enabled ? 'Tự bật thêm' : 'Tự tắt thêm'} ${fmtNumber(automatic.length)} quyền ${enabled ? 'liên quan' : 'phụ thuộc'}` : `Đã ${enabled ? 'bật' : 'tắt'}: ${labels.get(key)}`,
      details: automatic.map((permission) => labels.get(permission)).join(', '),
    });
    onChange(next);
  }

  return <section aria-label="Phân quyền">
    <Space wrap style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
      <Space size={8}>
        <Typography.Text strong>Quyền truy cập</Typography.Text>
        <Tag data-testid="permission-selection-count" style={{ margin: 0 }}>{fmtNumber(value.length)}/{fmtNumber(PERMISSION_CATALOG.length)} quyền</Tag>
        <Tooltip title={help}><Button type="text" size="small" aria-label="Hướng dẫn phân quyền" icon={<InfoCircleOutlined />} /></Tooltip>
      </Space>
      <Button type="link" size="small" disabled={!visible.length} onClick={() => setExpanded(allOpen ? [] : visible.map((section) => section.key))}>{allOpen ? 'Thu gọn' : 'Mở tất cả'}</Button>
    </Space>
    <Input aria-label="Tìm quyền" placeholder="Tìm menu hoặc thao tác…" prefix={<SearchOutlined />} allowClear value={query}
      onChange={(event) => {
        const text = event.target.value;
        setQuery(text);
        setExpanded(text ? visibleSections(text).map((section) => section.key) : []);
      }} style={{ marginBottom: 8 }} />
    <div role="status" aria-live="polite" style={{ minHeight: 28, paddingBottom: 8, fontSize: 12 }}>
      {feedback ? <Tooltip title={feedback.details || undefined}><Typography.Text type="secondary" style={{ fontSize: 12 }}>{feedback.text}</Typography.Text></Tooltip>
        : <Typography.Text type="secondary" style={{ fontSize: 12 }}>Chọn nhóm để xem quyền. Các quyền liên quan được đồng bộ tự động.</Typography.Text>}
    </div>
    {visible.length ? <Collapse activeKey={expanded} onChange={(keys) => setExpanded(typeof keys === 'string' ? [keys] : keys)} items={visible.map((section) => ({
      key: section.key,
      label: <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <Typography.Text strong>{section.name}</Typography.Text>
        <Typography.Text type="secondary" style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{fmtNumber(section.permissions.filter((entry) => value.includes(entry.key)).length)}/{fmtNumber(section.permissions.length)} đã bật</Typography.Text>
      </div>,
      children: <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {[...new Set(section.visible.map((entry) => entry.group))].map((group) => <div key={group}>
          <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 8 }}>{group}</Typography.Text>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))', gap: '12px 20px' }}>
            {section.visible.filter((entry) => entry.group === group).map((entry) => <Tooltip key={entry.key} title={entry.requires.length ? `Cần: ${entry.requires.map((key) => labels.get(key)).join(', ')}` : undefined}>
              <Checkbox disabled={disabled} checked={value.includes(entry.key)} onChange={(event) => toggle(entry.key, event.target.checked)}>{entry.label}</Checkbox>
            </Tooltip>)}
          </div>
        </div>)}
      </Space>,
    }))} /> : <EmptyState title="Không tìm thấy quyền phù hợp" />}
  </section>;
}
