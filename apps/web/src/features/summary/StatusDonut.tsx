import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip as RTooltip } from 'recharts';
import { fmtNumber } from '../../lib/number';

export function StatusDonut({ data, onSlice, totalLabel }: { data: { total: number; items: { statusId: number; name: string; color: string; count: number }[] }; onSlice: (statusId: number) => void; totalLabel: string }) {
  const items = data.items.filter((i) => i.count > 0);
  return (
    <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ position: 'relative', width: 240, height: 240 }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie data={items} dataKey="count" nameKey="name" innerRadius={72} outerRadius={110} paddingAngle={1} onClick={(d: any) => onSlice(d.statusId)} cursor="pointer" isAnimationActive={false}>
              {items.map((i) => <Cell key={i.statusId} fill={i.color} />)}
            </Pie>
            <RTooltip formatter={(value) => typeof value === 'number' ? fmtNumber(value) : value} />
          </PieChart>
        </ResponsiveContainer>
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none', textAlign: 'center' }}>
          <div><div style={{ fontSize: 28, fontWeight: 700 }}>{fmtNumber(data.total)}</div><div className="muted" style={{ fontSize: 12 }}>{totalLabel}</div></div>
        </div>
      </div>
      <div style={{ maxHeight: 220, overflow: 'auto', flex: 1, minWidth: 180 }}>
        {data.items.map((i) => (
          <div key={i.statusId} onClick={() => i.count && onSlice(i.statusId)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', cursor: i.count ? 'pointer' : 'default' }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: i.color, display: 'inline-block' }} />
            <span>{i.name}: <b>{fmtNumber(i.count)}</b></span>
          </div>
        ))}
      </div>
    </div>
  );
}

