import { Badge, Card, Col, List, Progress, Row, Space, Statistic, Tag, Typography } from 'antd';
import { ListTable } from '../../components/ListTable';
import { NumberedList } from '../../components/NumberedList';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { getDashboard } from '../../api/generated/api';
import { QueryBoundary } from '../../components/EmptyState';
import { IssueTypeIcon } from '../../components/IssueTypeIcon';
import { PriorityIcon } from '../../components/PriorityIcon';
import { StatusTag } from '../../components/StatusTag';
import { fmtDateTime, fromNow } from '../../lib/date';
import { TriageButtons } from '../issues/TriageButtons';
import { useSelectedIssue } from '../issues/useSelectedIssue';
import { ActivityList } from './ActivityList';

export function DashboardPage() {
  const { data, isLoading, error, refetch } = useQuery<any>({ queryKey: ['dashboard'], queryFn: () => getDashboard() });
  const { select } = useSelectedIssue();
  const nav = useNavigate();
  return (
    <div className="page">
      <QueryBoundary isLoading={isLoading} error={error} refetch={refetch}>
        {data && (
          <>
            <Row gutter={[16, 16]}>
              {[['Hoàn thành', data.cards.completedLast7d, '7 ngày qua'], ['Cập nhật', data.cards.updatedLast7d, '7 ngày qua'], ['Tạo mới', data.cards.createdLast7d, '7 ngày qua'], ['Đến hạn', data.cards.dueNext7d, '7 ngày tới']].map(([t, v, s]) => (
                <Col key={t as string} xs={12} md={6}><Card><Statistic title={<span>{t} <span className="muted">· {s}</span></span>} value={v as number} /></Card></Col>
              ))}
            </Row>

            {data.canTriage && (
              <Card style={{ marginTop: 16 }} title={<Space>Bug auto chờ duyệt <Badge count={data.pendingReview.length} color="#722ed1" showZero /></Space>}>
                <ListTable size="small" rowKey="id" dataSource={data.pendingReview} locale={{ emptyText: 'Không có bug nào chờ duyệt 🎉' }}
                  onRow={(r: any) => ({ onClick: () => select(r.key), style: { cursor: 'pointer' } })}
                  columns={[
                    { title: 'Mã', dataIndex: 'key', width: 110, render: (k) => <b>{k}</b> },
                    { title: 'Tiêu đề', dataIndex: 'title', ellipsis: true },
                    { title: 'Dự án', dataIndex: ['project', 'key'], width: 90, render: (k) => <Tag>{k}</Tag> },
                    { title: 'Số lần', dataIndex: 'occurrenceCount', width: 80, align: 'right' },
                    { title: 'Gặp gần nhất', dataIndex: 'lastSeenAt', width: 150, render: (v) => <span title={fmtDateTime(v)}>{fromNow(v)}</span> },
                    { title: '', width: 260, render: (_, r: any) => <TriageButtons issueKey={r.key} projectKey={r.project.key} onDone={() => refetch()} /> },
                  ]} />
              </Card>
            )}

            <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
              <Col xs={24} lg={12}>
                <Card title="Việc của tôi" style={{ height: '100%' }}>
                  {data.myWork.length === 0 && <Typography.Text type="secondary">Bạn chưa được giao việc nào</Typography.Text>}
                  {data.myWork.map((g: any) => (
                    <div key={g.projectKey} style={{ marginBottom: 12 }}>
                      <Link to={`/projects/${g.projectKey}/backlog`}><b>{g.projectKey}</b> · {g.projectName}</Link>
                      <NumberedList rowKey="id" size="small" dataSource={g.issues} renderItem={(i: any, index) => (
                        <List.Item onClick={() => select(i.key)} style={{ cursor: 'pointer' }}>
                          <Space><span aria-label="STT" className="muted">{index + 1}.</span><IssueTypeIcon type={i.type} /><span className="muted">{i.key}</span><span>{i.title}</span></Space>
                          <Space><PriorityIcon priority={i.priority} /><StatusTag status={i.status} /></Space>
                        </List.Item>
                      )} />
                    </div>
                  ))}
                </Card>
              </Col>
              <Col xs={24} lg={12}>
                <Card title="Lần chạy gần đây" style={{ marginBottom: 16 }}>
                  <NumberedList rowKey="id" size="small" locale={{ emptyText: 'Chưa có lần chạy nào' }} dataSource={data.recentRuns} renderItem={(r: any, index) => (
                    <List.Item onClick={() => nav(`/reports/runs/${r.id}`)} style={{ cursor: 'pointer' }}>
                      <Space><span aria-label="STT" className="muted">{index + 1}.</span><Tag>{r.projectKey}</Tag><span>#{r.id} {r.name ?? ''}</span><span className="muted">{r.environment}</span></Space>
                      <Space><Progress percent={r.passRate ?? 0} size="small" style={{ width: 90 }} status={r.failed ? 'exception' : 'success'} /> {r.bugsCreated > 0 && <Tag color="purple">+{r.bugsCreated} bug</Tag>}</Space>
                    </List.Item>
                  )} />
                </Card>
                <Card title="Hoạt động gần đây"><ActivityList items={data.recentActivity} /></Card>
              </Col>
            </Row>
          </>
        )}
      </QueryBoundary>
    </div>
  );
}
