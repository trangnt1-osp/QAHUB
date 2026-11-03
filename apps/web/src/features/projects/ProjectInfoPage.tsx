import { Card, Descriptions, Space } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { getProject } from '../../api/generated/api';
import { QueryBoundary } from '../../components/EmptyState';
import { UserAvatar } from '../../components/UserAvatar';
import { fmtDate } from '../../lib/date';
import { ProjectMembers } from './ProjectMembers';
import { ProjectPeriods } from './ProjectPeriods';
import { usePermission } from '../auth/authStore';

export default function ProjectInfoPage() {
  const { projectKey = '' } = useParams();
  const viewPeriods = usePermission(projectKey, 'period.view');
  const viewMembers = usePermission(projectKey, 'project.members.view');
  const { data: project, isLoading, error, refetch } = useQuery({ queryKey: ['project', projectKey], queryFn: () => getProject(projectKey) });
  return <div className="page">
    <QueryBoundary isLoading={isLoading} error={error} refetch={refetch}>
      {project && <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Card title="Thông tin dự án">
          <Descriptions column={{ xs: 1, md: 2 }} items={[
            { key: 'key', label: 'Mã dự án', children: project.key },
            { key: 'name', label: 'Tên dự án', children: project.name },
            { key: 'lead', label: 'Lead', children: project.lead ? <UserAvatar user={project.lead} showName /> : '—' },
            { key: 'start', label: 'Ngày bắt đầu', children: fmtDate(project.startDate) },
            { key: 'end', label: 'Ngày kết thúc', children: fmtDate(project.endDate) },
            { key: 'description', label: 'Mô tả', children: project.description || '—', span: 2 },
          ]} />
        </Card>
        {viewPeriods && <ProjectPeriods projectKey={projectKey} trackingMode={project.trackingMode} />}
        {viewMembers && <ProjectMembers projectKey={projectKey} />}
      </Space>}
    </QueryBoundary>
  </div>;
}
