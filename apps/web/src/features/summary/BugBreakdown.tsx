import { Button, Card, Empty, Typography } from 'antd';
import type { ReactNode } from 'react';
import { fmtNumber } from '../../lib/number';

export interface BugBreakdownRow {
  key: string;
  label: ReactNode;
  count: number;
  value: string | number | null;
}

export function BugBreakdown({ title, rows, onSelect, note }: { title: string; rows: BugBreakdownRow[]; onSelect: (value: BugBreakdownRow['value']) => void; note?: string }) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return <Card title={title} size="small" style={{ height: '100%' }}>
    {rows.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Không có dữ liệu" /> : <div style={{ maxHeight: 280, overflow: 'auto' }}>
      {rows.map((row) => <Button key={row.key} type="text" block onClick={() => onSelect(row.value)} style={{ height: 'auto', padding: '6px 4px', display: 'grid', gridTemplateColumns: 'minmax(110px, 1fr) minmax(80px, 2fr) 44px', alignItems: 'center', gap: 8, textAlign: 'left' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.label}</span>
        <span style={{ background: '#f0f0f0', borderRadius: 4, height: 10 }}><span style={{ display: 'block', width: `${row.count / max * 100}%`, background: '#f51d53', height: 10, borderRadius: 4 }} /></span>
        <strong style={{ textAlign: 'right' }}>{fmtNumber(row.count)}</strong>
      </Button>)}
    </div>}
    {note && <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>{note}</Typography.Text>}
  </Card>;
}
