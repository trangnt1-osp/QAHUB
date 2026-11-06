import { ExportOutlined } from '@ant-design/icons';
import { Button, Drawer } from 'antd';
import { useNavigate } from 'react-router-dom';
import { IssueDetailView } from './IssueDetailView';
import { useSelectedIssue } from './useSelectedIssue';

/** Drawer chi tiết item, mở khi URL có ?selectedIssue=KEY (mục 9). */
export function IssueDrawerHost() {
  const { selected, select } = useSelectedIssue();
  const nav = useNavigate();
  return (
    <Drawer maskClosable={false} open={!!selected} onClose={() => select(null)} width="min(1100px, 92vw)" destroyOnClose title={selected}
      extra={selected && <Button icon={<ExportOutlined />} onClick={() => { select(null); nav(`/browse/${selected}`); }}>Mở trang riêng</Button>}>
      {selected && <IssueDetailView issueKey={selected} onDeleted={() => select(null)} />}
    </Drawer>
  );
}
