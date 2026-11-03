import { fmtNumber, parseNumber } from '../../lib/number';
import { DeleteOutlined, LinkOutlined } from '@ant-design/icons';
import { App, Button, Card, Collapse, DatePicker, Descriptions, Divider, Empty, InputNumber, List, Popconfirm, Select, Space, Tabs, Tag, Timeline, Typography } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PRIORITIES } from '@ospm/shared';
import {
  addComment, deleteComment, deleteIssue, getIssue, getIssueActivity, listComments, transitionIssue, updateIssue,
} from '../../api/generated/api';
import { errorCode, errorMessage } from '../../api/http';
import { useProjectTracking, useSprints } from '../../api/hooks';
import type { IssueDetail } from '../../api/models';
import { AttachmentList } from '../../components/AttachmentList';
import { QueryBoundary } from '../../components/EmptyState';
import { IssueTypeIcon } from '../../components/IssueTypeIcon';
import { LabelSelect } from '../../components/LabelSelect';
import { PriorityIcon } from '../../components/PriorityIcon';
import { isEmptyDoc, RichTextEditor } from '../../components/RichTextEditor';
import { SourceTag } from '../../components/SourceTag';
import { StatusTag } from '../../components/StatusTag';
import { UserAvatar } from '../../components/UserAvatar';
import { UserSelect } from '../../components/UserSelect';
import { fmtDateTime, fromNow } from '../../lib/date';
import { useAuth, usePermission } from '../auth/authStore';
import { TriageButtons } from './TriageButtons';
import { useSelectedIssue } from './useSelectedIssue';
import { IssueStructureFields } from './IssueStructureFields';

const projectKeyOf = (key: string) => key.slice(0, key.lastIndexOf('-'));

interface IssueDetailViewProps { issueKey: string; onDeleted?: () => void }

export function IssueDetailView(props: IssueDetailViewProps) {
  const canView = usePermission(projectKeyOf(props.issueKey), 'issue.view');
  return canView ? <AuthorizedIssueDetailView {...props} /> : null;
}

function AuthorizedIssueDetailView({ issueKey, onDeleted }: IssueDetailViewProps) {
  const projectKey = projectKeyOf(issueKey);
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { select } = useSelectedIssue();
  const user = useAuth((s) => s.user);
  const canEdit = usePermission(projectKey, 'issue.edit');
  const canTriage = usePermission(projectKey, 'issue.triage');
  const canDeleteAny = usePermission(projectKey, 'issue.delete.any');
  const canDeleteOwn = usePermission(projectKey, 'issue.delete');
  const canTransition = usePermission(projectKey, 'issue.transition');
  const canComment = usePermission(projectKey, 'issue.comment');
  const canViewAttachments = usePermission(projectKey, 'attachment.view');
  const canUpload = usePermission(projectKey, 'attachment.create');
  const isAdmin = useAuth((state) => state.user?.systemRole === 'admin' || state.projects.some((project) => project.projectKey === projectKey && !project.roleId && project.role === 'admin'));
  const { data: issue, isLoading, error, refetch } = useQuery<IssueDetail>({ queryKey: ['issue', issueKey], queryFn: () => getIssue(issueKey) });
  const { data: sprints = [] } = useSprints(projectKey);
  const phase = useProjectTracking(projectKey) === 'phase';
  const [busy, setBusy] = useState(false);
  const [structureSaving, setStructureSaving] = useState(false);
  const [comment, setComment] = useState<Record<string, unknown> | null>(null);
  const [descDraft, setDescDraft] = useState<Record<string, unknown> | null>(null);
  const [editorKey, setEditorKey] = useState(0);

  const refresh = async () => { await qc.invalidateQueries(); };

  /** Sửa nhanh có cập nhật lạc quan; lỗi thì hoàn tác. 409 -> báo "Item vừa được người khác sửa". */
  const patch = async (body: Record<string, unknown>, optimistic?: Partial<IssueDetail>) => {
    if (!issue || !canEdit) return;
    const prev = issue;
    if (optimistic) qc.setQueryData(['issue', issueKey], { ...issue, ...optimistic });
    try {
      await updateIssue(issueKey, { version: issue.version, ...body } as any);
      await refresh();
    } catch (e) {
      qc.setQueryData(['issue', issueKey], prev);
      if (errorCode(e) === 'VERSION_CONFLICT') { message.warning('Item vừa được người khác sửa'); await refetch(); } else message.error(errorMessage(e));
    }
  };

  const transition = async (toStatusId: number) => {
    if (!canTransition) return;
    setBusy(true);
    try { await transitionIssue(issueKey, { toStatusId }); await refresh(); } catch (e) { message.error(errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <QueryBoundary isLoading={isLoading} error={error} refetch={refetch}>
      {issue && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 320px', gap: 24 }}>
          <div>
            <Space style={{ marginBottom: 8 }}>
              <IssueTypeIcon type={issue.type} /><Typography.Text type="secondary">{issue.key}</Typography.Text>
              {issue.source === 'auto' && <SourceTag source="auto" />}
              {issue.labels.filter((l) => !l.isSystem).map((l) => <Tag key={l.id} color={l.color}>{l.name}</Tag>)}
            </Space>
            <Typography.Title level={3} style={{ marginTop: 0 }}
              editable={canEdit ? { onChange: (t) => t.trim() && t !== issue.title && patch({ title: t.trim() }, { title: t.trim() }), text: issue.title } : false}>
              {issue.title}
            </Typography.Title>

            {issue.autoInfo && (
              <Card size="small" title="Thông tin tự động" style={{ marginBottom: 16, borderColor: '#d3adf7' }}>
                <Descriptions size="small" column={2}>
                  <Descriptions.Item label="Số lần xuất hiện">{fmtNumber(issue.autoInfo.occurrenceCount)}</Descriptions.Item>
                  <Descriptions.Item label="Lần đầu">{fmtDateTime(issue.autoInfo.firstSeenAt)}</Descriptions.Item>
                  <Descriptions.Item label="Lần cuối">{fmtDateTime(issue.autoInfo.lastSeenAt)}</Descriptions.Item>
                  <Descriptions.Item label="Lần chạy gần nhất">
                    {issue.autoInfo.lastRun ? <Link to={`/reports/runs/${issue.autoInfo.lastRun.id}`}>Run #{issue.autoInfo.lastRun.id}</Link> : '—'}
                    {issue.autoInfo.lastRun?.ciUrl && <a href={issue.autoInfo.lastRun.ciUrl} target="_blank" rel="noreferrer" style={{ marginLeft: 8 }}><LinkOutlined /> CI</a>}
                  </Descriptions.Item>
                  <Descriptions.Item label="Test" span={2}>{issue.autoInfo.file ? `${issue.autoInfo.file}${issue.autoInfo.line ? `:${issue.autoInfo.line}` : ''}` : '—'}</Descriptions.Item>
                  <Descriptions.Item label="Lỗi" span={2}><Typography.Text code style={{ whiteSpace: 'pre-wrap' }}>{issue.autoInfo.errorMessage ?? '—'}</Typography.Text></Descriptions.Item>
                </Descriptions>
                {issue.status.category === 'triage' && canTriage && <div style={{ marginTop: 8 }}><TriageButtons issueKey={issue.key} projectKey={projectKey} size="middle" /></div>}
              </Card>
            )}

            <Typography.Title level={5}>Mô tả</Typography.Title>
            <RichTextEditor key={editorKey} value={issue.description as any} editable={canEdit} onChange={setDescDraft} placeholder="Thêm mô tả…" />
            {canEdit && descDraft && (
              <Space style={{ marginTop: 8 }}>
                <Button type="primary" size="small" onClick={async () => { await patch({ description: descDraft }); setDescDraft(null); }}>Lưu mô tả</Button>
                <Button size="small" onClick={() => { setDescDraft(null); setEditorKey((k) => k + 1); }}>Hủy</Button>
              </Space>
            )}

            <Divider orientation="left" plain>Subtask</Divider>
            {issue.subtasks.length === 0 ? <Typography.Text type="secondary">Chưa có subtask</Typography.Text> : (
              <List size="small" dataSource={issue.subtasks} renderItem={(s) => (
                <List.Item onClick={() => select(s.key)} style={{ cursor: 'pointer' }}>
                  <Space><IssueTypeIcon type={s.type} /><span>{s.key}</span><span>{s.title}</span></Space>
                  <Space><StatusTag status={s.status} /><UserAvatar user={s.assignee} size={20} /></Space>
                </List.Item>
              )} />
            )}

            <Divider orientation="left" plain>Liên kết</Divider>
            {issue.links.length === 0 ? <Typography.Text type="secondary">Chưa có liên kết</Typography.Text> : (
              <List size="small" dataSource={issue.links} renderItem={(l) => (
                <List.Item onClick={() => select(l.issue.key)} style={{ cursor: 'pointer' }}>
                  <Space><Tag>{l.direction === 'outward' ? l.type.replace('_', ' ') : `${l.type.replace('_', ' ')} (ngược)`}</Tag><IssueTypeIcon type={l.issue.type} /><span>{l.issue.key} {l.issue.title}</span></Space>
                  <StatusTag status={l.issue.status} />
                </List.Item>
              )} />
            )}

            <Divider orientation="left" plain>File đính kèm</Divider>
            {canViewAttachments && <AttachmentList items={issue.attachments} entity="issue" entityId={issue.id} onUploaded={refresh} readOnly={!canUpload} />}

            <Tabs style={{ marginTop: 16 }} items={[
              { key: 'comments', label: 'Comment', children: (
                <CommentsTab issueKey={issueKey} userId={user?.id} canEdit={canComment} isAdmin={isAdmin} comment={comment} setComment={setComment} onChanged={refresh} />
              ) },
              { key: 'history', label: 'Lịch sử', children: <HistoryTab issueKey={issueKey} /> },
            ]} />
          </div>

          <div>
            <Card size="small">
              <div style={{ marginBottom: 12 }}>
                <StatusTag status={issue.status} transitions={issue.availableTransitions} onTransition={canTransition ? transition : undefined} loading={busy} />
                {issue.status.category === 'triage' && canTriage && <div style={{ marginTop: 8 }}><TriageButtons issueKey={issue.key} projectKey={projectKey} /></div>}
              </div>
              <Descriptions column={1} size="small" colon={false} labelStyle={{ width: 96, color: '#8c8c8c' }}>
                <Descriptions.Item label="Assignee">
                  {canEdit ? <UserSelect projectKey={projectKey} value={issue.assignee?.id} onChange={(id) => patch({ assigneeId: id })} style={{ width: 190 }} /> : <UserAvatar user={issue.assignee} showName />}
                </Descriptions.Item>
                <Descriptions.Item label="Reporter">{issue.reporter ? <UserAvatar user={issue.reporter} showName /> : issue.createdByApiKey ? `API key: ${issue.createdByApiKey.name}` : '—'}</Descriptions.Item>
                <Descriptions.Item label="Priority">
                  {canEdit ? <Select style={{ width: 190 }} value={issue.priority} onChange={(v) => patch({ priority: v }, { priority: v })} options={PRIORITIES.map((p) => ({ value: p, label: <PriorityIcon priority={p} withLabel /> }))} /> : <PriorityIcon priority={issue.priority} withLabel />}
                </Descriptions.Item>
                <Descriptions.Item label={phase ? 'Phase' : 'Sprint'}>
                  <Select allowClear disabled={!canEdit || issue.status.category === 'triage'} style={{ width: 190 }} placeholder={issue.status.category === 'triage' ? 'Cần duyệt trước' : 'Backlog'} value={issue.sprintId ?? undefined}
                    onChange={(v) => patch({ sprintId: v ?? null })} options={sprints.map((s) => ({ value: s.id, label: s.name }))} />
                </Descriptions.Item>
                <Descriptions.Item label="Epic/Cha">{issue.parent ? <a onClick={() => select(issue.parent!.key)}>{issue.parent.key} {issue.parent.title}</a> : '—'}</Descriptions.Item>
                <Descriptions.Item label="Label">
                  {canEdit ? <LabelSelect projectKey={projectKey} value={issue.labels.map((l) => l.id)} onChange={(ids) => patch({ labelIds: ids })} style={{ width: 190 }} /> : issue.labels.map((l) => <Tag key={l.id} color={l.color}>{l.name}</Tag>)}
                </Descriptions.Item>
                <Descriptions.Item label="Estimate (phút)">
                  <InputNumber min={0} disabled={!canEdit} value={issue.estimateMinutes ?? undefined}
                    formatter={(value, { userTyping, input }) => userTyping ? input : value === undefined || value === null ? '' : fmtNumber(value)}
                    parser={(text) => parseNumber(text ?? '')}
                    onBlur={(e) => { const v = e.target.value.trim() === '' ? null : parseNumber(e.target.value); if (v !== null && !Number.isFinite(v)) return; if (v !== issue.estimateMinutes) patch({ estimateMinutes: v }); }} />
                </Descriptions.Item>
                <Descriptions.Item label="Due date">
                  <DatePicker disabled={!canEdit} value={issue.dueDate ? dayjs(issue.dueDate) : null} format="DD/MM/YYYY" onChange={(d) => patch({ dueDate: d ? d.format('YYYY-MM-DD') : null })} />
                </Descriptions.Item>
                <Descriptions.Item label="Tạo lúc">{fmtDateTime(issue.createdAt)}</Descriptions.Item>
                <Descriptions.Item label="Cập nhật">{fmtDateTime(issue.updatedAt)}</Descriptions.Item>
              </Descriptions>
              <Collapse size="small" style={{ marginTop: 12 }} defaultActiveKey={['structure']} items={[{ key: 'structure', label: 'Epic / Module / Function', children: canEdit
                ? <IssueStructureFields projectKey={projectKey} disabled={structureSaving} showEpic={issue.type !== 'epic' && issue.type !== 'subtask'}
                    value={{ parentKey: issue.parent?.key, moduleIds: issue.explicitModuleIds ?? issue.moduleIds ?? [], functionIds: issue.functionIds ?? [] }}
                    onChange={async (value) => {
                      if (structureSaving) return;
                      setStructureSaving(true);
                      try { await patch({ moduleIds: value.moduleIds, functionIds: value.functionIds, ...(issue.type !== 'epic' && issue.type !== 'subtask' ? { parentKey: value.parentKey ?? null } : {}) }); }
                      finally { setStructureSaving(false); }
                    }} />
                : <Space direction="vertical">
                    <div><Typography.Text type="secondary">Module: </Typography.Text>{issue.modules?.length ? issue.modules.map((module) => <Tag key={module.id}>{module.code} · {module.name}</Tag>) : '—'}</div>
                    <div><Typography.Text type="secondary">Function: </Typography.Text>{issue.functions?.length ? issue.functions.map((fn) => <Tag key={fn.id}>{fn.code} · {fn.name}</Tag>) : '—'}</div>
                  </Space> }]} />
              {(canDeleteAny || (canDeleteOwn && issue.reporter?.id === user?.id)) && (
                <Popconfirm title="Xóa item này?" okText="Xóa" cancelText="Hủy" okButtonProps={{ danger: true }} onConfirm={async () => { if (!(canDeleteAny || (canDeleteOwn && issue.reporter?.id === user?.id))) return; try { await deleteIssue(issueKey); message.success('Đã xóa'); await refresh(); onDeleted?.(); } catch (e) { message.error(errorMessage(e)); } }}>
                  <Button danger type="text" icon={<DeleteOutlined />} style={{ marginTop: 8 }}>Xóa</Button>
                </Popconfirm>
              )}
            </Card>
          </div>
        </div>
      )}
    </QueryBoundary>
  );
}

function CommentsTab({ issueKey, userId, canEdit, isAdmin, comment, setComment, onChanged }: {
  issueKey: string; userId?: number; canEdit: boolean; isAdmin: boolean; comment: Record<string, unknown> | null; setComment: (c: Record<string, unknown> | null) => void; onChanged: () => void;
}) {
  const { data = [], isLoading } = useQuery<any[]>({ queryKey: ['comments', issueKey], queryFn: () => listComments(issueKey) });
  const { message } = App.useApp();
  const [key, setKey] = useState(0);
  return (
    <div>
      {canEdit && (
        <div style={{ marginBottom: 16 }}>
          <RichTextEditor key={key} onChange={setComment} placeholder="Viết comment…" />
          <Button type="primary" size="small" style={{ marginTop: 8 }} disabled={isEmptyDoc(comment)}
            onClick={async () => { if (!canEdit) return; try { await addComment(issueKey, { body: comment! }); setComment(null); setKey((k) => k + 1); onChanged(); } catch (e) { message.error(errorMessage(e)); } }}>Gửi</Button>
        </div>
      )}
      {!isLoading && data.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có comment" />}
      {data.map((c) => (
        <div key={c.id} style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
          <UserAvatar user={c.author ?? { id: 0, displayName: 'Hệ thống' }} />
          <div style={{ flex: 1 }}>
            <Space size={8}><b>{c.author?.displayName ?? 'Hệ thống'}</b><span className="muted" title={fmtDateTime(c.createdAt)}>{fromNow(c.createdAt)}</span>
              {(canEdit && (c.authorId === userId || isAdmin)) && <a onClick={async () => { if (!canEdit) return; await deleteComment(c.id); onChanged(); }}>Xóa</a>}</Space>
            <RichTextEditor value={c.body} editable={false} />
          </div>
        </div>
      ))}
    </div>
  );
}

const ACTION_LABEL: Record<string, string> = { created: 'đã tạo item', updated: 'đã cập nhật', status_changed: 'đã đổi trạng thái', commented: 'đã comment', triaged: 'đã duyệt bug', seen_again: 'bug xuất hiện lại', linked: 'đã liên kết', unlinked: 'đã gỡ liên kết', deleted: 'đã xóa' };

function HistoryTab({ issueKey }: { issueKey: string }) {
  const { data, isLoading } = useQuery<{ items: any[] }>({ queryKey: ['issue-activity', issueKey], queryFn: () => getIssueActivity(issueKey) });
  if (!isLoading && !data?.items.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có lịch sử" />;
  return (
    <Timeline items={(data?.items ?? []).map((a) => ({
      children: (
        <div>
          <b>{a.actor?.displayName ?? (a.apiKey ? `API key: ${a.apiKey.name}` : 'Hệ thống')}</b> {ACTION_LABEL[a.action] ?? a.action}{' '}
          <span className="muted">{fromNow(a.createdAt)}</span>
          {a.changes && Object.entries(a.changes).map(([k, v]) => (
            <div key={k} className="muted" style={{ fontSize: 12 }}>{k}: {Array.isArray(v) ? `${fmtVal(v[0])} → ${fmtVal(v[1])}` : fmtVal(v)}</div>
          ))}
        </div>
      ),
    }))} />
  );
}
const fmtVal = (v: unknown) => (v === null || v === undefined || v === '' ? '∅' : typeof v === 'object' ? JSON.stringify(v) : String(v));
