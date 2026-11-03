# Project Bug Summary Dashboard Design

## Intent

Nâng cấp trực tiếp trang Summary của từng dự án thành dashboard theo dõi Bug cho stakeholder. Trang phải trả lời nhanh dự án đang có bao nhiêu Bug cần xử lý, mức độ nghiêm trọng ra sao và Bug tập trung ở module, Phase/Sprint hay tính năng nào.

## Goals

- Chỉ thống kê issue có `type = bug`; “Loại Bug” trong yêu cầu chính là giá trị Bug của trường loại item hiện có.
- Mặc định hiển thị Bug đang mở, được định nghĩa là Bug có workflow status category khác `done`.
- Cho phép chuyển phạm vi giữa “Bug đang mở” và “Tất cả Bug”.
- Hiển thị bốn KPI: tổng Bug trong phạm vi, Bug `highest`, Bug chưa phân công và Bug mới tạo trong 7 ngày.
- Phân tích Bug theo trạng thái, Module, Epic, Phase/Sprint, Function/Tính năng và Priority.
- Cho phép bấm vào KPI hoặc phần tử biểu đồ để mở Backlog với bộ lọc tương ứng, luôn kèm `type=bug`.
- Giữ Recent activity ở cuối trang.
- Người có quyền `summary.view`/viewer hiện tại tiếp tục xem được dashboard; không tạo mô hình chia sẻ công khai mới.

## Non-goals

- Không thêm loại item hoặc trường “Bug category” mới.
- Không tạo tab/menu “Bug Dashboard” riêng.
- Không xây pivot table, xuất file hoặc dashboard tùy biến kéo-thả.
- Không thay đổi workflow hay cách tạo Bug.
- Không thay đổi Recent activity thành feed chỉ dành cho Bug trong phạm vi này; giữ hành vi activity dự án hiện có.

## UX Design

### Header and scope

- Giữ các bộ lọc assignee và source hiện có nếu chúng vẫn có ý nghĩa với Bug.
- Bỏ bộ lọc loại item vì trang đã cố định là Bug.
- Thêm segmented control “Bug đang mở” (mặc định) / “Tất cả Bug”.
- Các KPI và biểu đồ cùng tuân theo assignee, source và scope đang chọn.

### KPI row

1. **Tổng Bug đang mở** hoặc **Tổng Bug** tùy scope.
2. **Highest**: số Bug priority `highest` trong scope.
3. **Chưa phân công**: số Bug có `assigneeId = null` trong scope.
4. **Mới trong 7 ngày**: số Bug có `createdAt >= now() - 7 days` trong scope.

Mỗi KPI có thể click và drill down sang Backlog. KPI tổng chỉ áp dụng `type=bug` cộng điều kiện scope; các KPI còn lại bổ sung priority, unassigned hoặc khoảng ngày tương ứng. Nếu Backlog chưa hỗ trợ một filter cần thiết (priority, open-only, created range), bổ sung query/filter tương ứng thay vì tạo link không chính xác.

### Charts

- Khu vực biểu đồ tổng quan dùng tiêu đề **Report BUG** thay cho “Status overview”.
- **Theo trạng thái**: donut hiện tại, chỉ tính Bug trong scope; click truyền `statusIds`.
- **Theo Module**: bar chart/list xếp giảm dần; click truyền `moduleId`. Có nhóm “Chưa gắn Module”.
- **Theo Epic**: bar chart/list xếp giảm dần theo Epic cha; click truyền `epicId`. Có nhóm “Chưa gắn Epic”.
- **Theo Phase/Sprint**: dùng nhãn theo `project.trackingMode`; click truyền `sprintId`. Có nhóm “Backlog/Chưa phân bổ”. Dữ liệu lịch sử vẫn dùng period thực tế gắn trên Bug.
- **Theo Function**: bar chart/list xếp giảm dần; click truyền `functionId`. Có nhóm “Chưa gắn Function”.
- **Theo Priority**: phân bố theo thứ tự `highest`, `high`, `medium`, `low`, `lowest`; click truyền filter priority mới của Backlog.

Vì một Bug có thể gắn nhiều Module hoặc Function, nó được tính một lần trong mỗi nhóm liên quan. Tổng các nhóm ở hai biểu đồ này có thể lớn hơn tổng Bug; UI hiển thị chú thích ngắn để tránh hiểu nhầm. Nhóm “chưa gắn” chỉ chứa Bug không có quan hệ trực tiếp hoặc kế thừa tương ứng theo cùng quy tắc cấu trúc đang dùng ở Backlog.

### Activity

- Giữ Recent activity hiện tại ở cuối trang và khả năng mở rộng/tải thêm.
- Activity vẫn là activity toàn dự án, không thay đổi theo toggle Bug đang mở/Tất cả Bug.

### Empty and responsive states

- Khi không có Bug trong scope, KPI hiển thị 0 và khu vực biểu đồ hiển thị empty state rõ ràng.
- Desktop dùng lưới hai cột cho các breakdown; mobile xếp một cột.
- Danh sách breakdown dài giới hạn chiều cao và cuộn, không kéo dài toàn trang không kiểm soát.

## Data and API Design

- Mở rộng `GET /api/v1/projects/:projectKey/summary` với query `scope=open|all`, mặc định `open`.
- Backend luôn áp dụng `i.type = 'bug'`; không nhận type tùy ý từ client cho dashboard dự án.
- Bộ lọc chung (project, not deleted, Bug, scope, assignee, source) phải được áp dụng nhất quán cho KPI và mọi breakdown.
- Response mới trả các phần có kiểu rõ ràng: `scope`, `cards`, `statusOverview`, `byModule`, `byEpic`, `byPeriod`, `byFunction`, `byPriority`, và activity hiện có.
- Mỗi breakdown trả cả ID dùng để drill down, label hiển thị và count. Nhóm chưa gắn dùng ID/null marker rõ ràng.
- Các count dùng `count(distinct issue_id)` ở nơi join nhiều-nhiều để tránh nhân đôi trong cùng một nhóm.
- Mở rộng list/backlog filters tối thiểu với `priority`, `statusCategory` hoặc `openOnly`, và `createdFrom` khi cần để các KPI/chart link tái tạo đúng tập dữ liệu. Query được validate trong DTO và dùng chung qua `IssuesService.filterWhere`.
- Cập nhật OpenAPI/generated client sau khi contract thay đổi.

## Permissions and Safety

- Giữ permission của Summary hiện tại; backend tiếp tục giới hạn theo project context.
- Chỉ dùng ID thuộc dự án hiện tại trong aggregation và filter.
- Không đưa mô tả Bug hay dữ liệu nhạy cảm mới vào response dashboard.

## Testing and Acceptance

- Unit/integration tests backend chứng minh mặc định chỉ đếm Bug chưa done, `scope=all` gồm Bug done, và không đếm Task/Story.
- Tests cho KPI highest, unassigned, created 7d và từng breakdown, gồm Bug nhiều Module/Function và nhóm chưa gắn.
- Tests cho filter kết hợp assignee/source/scope và validation query.
- Frontend tests chứng minh scope mặc định là open, toggle gọi đúng query, render các KPI/breakdown, empty state và drill-down URL luôn có `type=bug` cùng filter tương ứng.
- Full API/web typecheck, tests và production build phải pass.

## Approaches Considered

1. **Nâng cấp Summary hiện tại — selected.** Đúng nơi stakeholder đã vào xem tổng quan, không tăng độ phức tạp menu và tái sử dụng status/activity hiện có.
2. **Tạo tab Bug Dashboard riêng.** Có nhiều không gian hơn nhưng phân mảnh trải nghiệm và thêm navigation không cần thiết.
3. **Dashboard dạng pivot table.** Mạnh cho báo cáo chi tiết nhưng khó đọc nhanh và không phù hợp mục tiêu theo dõi hằng ngày.

## Builder Decisions

- Có thể chọn loại biểu đồ bar ngang hoặc ranked list tùy component hiện có, miễn count, nhãn và click target rõ ràng.
- Có thể tách `SummaryPage` thành component nhỏ để giữ file dễ kiểm thử.
- Có thể giữ response field cũ tạm thời nếu cần tương thích, nhưng UI mới không được hiển thị thống kê Task/Story.
