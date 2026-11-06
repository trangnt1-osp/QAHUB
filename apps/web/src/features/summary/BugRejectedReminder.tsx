import { CoffeeOutlined } from '@ant-design/icons';
import { Empty, Tag, Typography } from 'antd';
import { UserAvatar } from '../../components/UserAvatar';
import { fmtNumber } from '../../lib/number';

export interface RejectedBugReminder {
  total: number;
  items: { user: { id: number; displayName: string; avatarUrl: string | null }; count: number }[];
}

export function BugRejectedReminder({ data }: { data: RejectedBugReminder }) {
  return <section className="bug-rejected-reminder" aria-label="Góc nhắc nhẹ">
    <div className="bug-rejected-kicker"><CoffeeOutlined /> MỘT CHÚT CÀ PHÊ, MỘT CHÚT RÚT KINH NGHIỆM</div>
    <div className="bug-rejected-mascot" aria-hidden="true">🕵️<span>?</span><b>✦</b></div>
    <Typography.Title level={3} style={{ margin: '12px 0' }}>Góc nhắc nhẹ ☕</Typography.Title>
    <p>Bug quay về, mình thêm manh mối rồi thử lại nhé! 🔍</p>
    {data.items.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Không có bug bị từ chối. Cả đội giữ phong độ nhé! 🎉" /> : <>
      <Tag color="orange">{fmtNumber(data.total)} bug bị từ chối trong kỳ</Tag>
      <div className="bug-rejected-people">
        {data.items.map((row) => <div className="bug-rejected-person" key={row.user.id}>
          <UserAvatar user={row.user} showName size={32} />
          <Tag>{fmtNumber(row.count)} bug bị từ chối</Tag>
        </div>)}
      </div>
      <p className="bug-rejected-tip">Bí kíp vòng sau: kiểm tra yêu cầu, ghi rõ bước tái hiện và đính kèm ảnh/log nhé. 🧩</p>
    </>}
    <p className="bug-rejected-note">Cùng kỳ tuần/tháng, tính theo ngày tạo bug. Chỉ tính bug log tay có người tạo; bỏ bug trùng, tự động và đã xóa. Số liệu nhắc nhẹ để cùng cải thiện, không trừ điểm vinh danh.</p>
  </section>;
}
