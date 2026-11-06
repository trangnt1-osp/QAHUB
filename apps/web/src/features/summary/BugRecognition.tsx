import { FullscreenExitOutlined, FullscreenOutlined, StarOutlined, TrophyOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { App, Button, Card, DatePicker, Empty, Segmented, Space, Statistic, Table, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useEffect, useRef, useState } from 'react';
import { http } from '../../api/http';
import { QueryBoundary } from '../../components/EmptyState';
import { UserAvatar } from '../../components/UserAvatar';
import { fmtDate, TZ } from '../../lib/date';
import { fmtNumber } from '../../lib/number';
import { BugRejectedReminder, type RejectedBugReminder } from './BugRejectedReminder';
import './bug-recognition.css';

interface Contributor {
  user: { id: number; displayName: string; avatarUrl: string | null };
  count: number;
  rank: number;
}
interface Contributors {
  period: 'week' | 'month';
  from: string;
  to: string;
  total: number;
  items: Contributor[];
  rejected: RejectedBugReminder;
}

export function BugRecognition({ projectKey }: { projectKey: string }) {
  const [period, setPeriod] = useState<'week' | 'month'>('week');
  const [date, setDate] = useState(() => dayjs().tz(TZ));
  const [fullscreen, setFullscreen] = useState(false);
  const [effects, setEffects] = useState(true);
  const root = useRef<HTMLDivElement>(null);
  const { message } = App.useApp();
  const params = { period, date: date.format('YYYY-MM-DD') };
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['bug-contributors', projectKey, params],
    queryFn: async () => (await http.get<Contributors>(`/api/v1/projects/${encodeURIComponent(projectKey)}/bug-contributors`, { params })).data,
  });
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === root.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const champions = data?.items.filter((row) => row.rank === 1) ?? [];
  const podium = data?.items.filter((row) => row.rank <= 3) ?? [];

  return <div className="bug-recognition page" ref={root} data-motion={effects ? 'on' : 'off'}>
    <div className="bug-recognition-toolbar">
      <Space wrap>
        <Segmented aria-label="Kỳ vinh danh" value={period} onChange={(value) => setPeriod(value as 'week' | 'month')} options={[{ value: 'week', label: 'Tuần' }, { value: 'month', label: 'Tháng' }]} />
        <DatePicker aria-label="Chọn kỳ vinh danh" picker={period === 'month' ? 'month' : 'week'} value={date} allowClear={false} onChange={(value) => { if (value) setDate(value); }} format={period === 'month' ? 'MM/YYYY' : '[Tuần] DD/MM/YYYY'} />
        <Button onClick={() => setDate(dayjs().tz(TZ))}>{period === 'week' ? 'Tuần này' : 'Tháng này'}</Button>
      </Space>
      <Space wrap>
      <Button icon={<StarOutlined />} aria-pressed={effects} onClick={() => setEffects((value) => !value)}>Lấp lánh: {effects ? 'bật' : 'tắt'}</Button>
      <Button icon={fullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />} disabled={!document.fullscreenEnabled} onClick={async () => {
        try {
          if (fullscreen) await document.exitFullscreen();
          else await root.current?.requestFullscreen();
        } catch { message.error('Không thể mở chế độ toàn màn hình'); }
      }}>{fullscreen ? 'Thu nhỏ' : 'Toàn màn hình'}</Button>
      </Space>
    </div>
    <QueryBoundary isLoading={isLoading} error={error} refetch={refetch}>
      {data && <>
        <div className="bug-recognition-spotlights">
        <section className="bug-recognition-hero" aria-label="Bug chưa ngủ, ta chưa nghỉ">
          <div className="bug-recognition-confetti" aria-hidden="true">{Array.from({ length: 18 }, (_, index) => <i key={index} style={{ left: `${(index * 37 + 7) % 100}%`, top: `${(index * 23 + 5) % 100}%`, animationDelay: `${-(index % 7) * 0.6}s`, rotate: `${index * 31}deg` }} />)}</div>
          <div className="bug-recognition-kicker"><TrophyOutlined /> BUG HUNTERS CLUB · {projectKey}</div>
          <div className="bug-recognition-trophy" aria-hidden="true"><span>🏆</span><b>✦</b><i>✧</i></div>
          <Typography.Title level={2} style={{ margin: '12px 0', color: 'inherit' }}>Bug chưa ngủ, ta chưa nghỉ 🦉</Typography.Title>
          <p className="bug-recognition-subtitle">Bắt bug hết mình. Lên bục hết nấc! 🚀</p>
          <Tag color="gold">{fmtDate(data.from)} – {fmtDate(dayjs(data.to).subtract(1, 'millisecond').toISOString())} · Giờ Việt Nam</Tag>
          {champions.length > 0 && <div className="bug-recognition-champions">
            <TrophyOutlined /> {champions.length > 1 ? 'Đồng hạng nhất' : 'Dẫn đầu'}: {champions.map((row) => row.user.displayName).join(' · ')}
          </div>}
          {data.items.length > 0 && <div className="bug-recognition-totals"><span><b>{fmtNumber(data.total)}</b> bug hợp lệ</span><span><b>{fmtNumber(data.items.length)}</b> người đóng góp</span></div>}
        </section>
        <BugRejectedReminder data={data.rejected ?? { total: 0, items: [] }} />
        </div>
        <p className="bug-recognition-rules">Tính theo người log và ngày tạo bug, gồm cả bug đã hoàn thành. Không tính bug trùng, bị từ chối, tự động, chờ duyệt, đã xóa hoặc không có người log. Người bằng điểm được đồng hạng.</p>
        {data.items.length === 0 ? <Empty description="Chưa có bug hợp lệ trong kỳ này" style={{ padding: 40 }} /> : <>
          <div className="bug-recognition-podium">
            {podium.map((row) => <Card key={row.user.id} className={`bug-recognition-person ${row.rank === 1 ? 'bug-recognition-winner' : ''}`}>
              <div className="bug-podium-medal" aria-hidden="true">{row.rank === 1 ? '👑' : row.rank === 2 ? '🥈' : '🥉'}</div>
              <Tag color={row.rank === 1 ? 'gold' : row.rank === 2 ? 'blue' : 'orange'}>{row.rank === 1 ? (champions.length > 1 ? 'Đồng hạng nhất' : 'Hạng nhất') : `Hạng ${row.rank}`}</Tag>
              <div style={{ margin: '20px 0 12px' }}><UserAvatar user={row.user} size={64} /></div>
              <Typography.Title level={4} style={{ margin: '8px 0' }}>{row.user.displayName}</Typography.Title>
              <div className="bug-podium-motto">{row.rank === 1 ? 'Radar bắt bug đỉnh nóc ✨' : row.rank === 2 ? 'Mắt tinh, bug khó trốn 🔎' : 'Bắt bug xịn, góp sức chất 💪'}</div>
              <Statistic value={row.count} groupSeparator="." suffix="bug hợp lệ" valueStyle={{ fontWeight: 700 }} />
            </Card>)}
          </div>
          <Card title="Bảng xếp hạng" style={{ marginTop: 24 }}>
            <Table<Contributor> rowKey={(row) => row.user.id} dataSource={data.items} pagination={{ pageSize: 10, hideOnSinglePage: true }} scroll={{ x: 440 }} columns={[
              { title: 'Hạng', dataIndex: 'rank', width: 80, render: (rank: number) => <Tag color={rank === 1 ? 'gold' : undefined}>{fmtNumber(rank)}</Tag> },
              { title: 'Người log bug', key: 'user', render: (_, row) => <UserAvatar user={row.user} showName size={32} /> },
              { title: 'Bug hợp lệ', dataIndex: 'count', width: 130, align: 'right', render: (count: number) => <strong>{fmtNumber(count)}</strong> },
            ]} />
          </Card>
        </>}
      </>}
    </QueryBoundary>
  </div>;
}
