# Đẩy Bug đã được QC xác nhận lên QA Hub

API này chỉ nhận thông tin Bug, không cần Playwright run, Allure, HTML hay AI. Client chịu trách nhiệm QC đã rà soát và xác nhận; `confirmed: true` là tuyên bố của client, không phải QA Hub tự xác minh lỗi sản phẩm.

## Xác thực

Trong QA Hub, tạo API key cho đúng dự án với scope **`issues:write`**. Key có scope `runs:write` đơn thuần không gọi được API này. Dùng HTTPS khi truy cập server; không commit key vào repo.

Base URL local: `http://localhost:3000`. Endpoint đầy đủ: `POST /api/v1/ingest/bugs`.

```http
Authorization: Bearer pmk_live_...
Content-Type: application/json
```

API key quyết định dự án đích. Không nhận `projectId` từ client. Key thiếu/sai/hết hạn/đã thu hồi bị từ chối; giới hạn chung `/ingest/*` là 60 request/phút/key. Kiểm tra key bằng `GET /api/v1/ingest/ping`.

## Tạo hàng loạt

Gửi 1–100 Bug mỗi request; `externalId` không trùng trong cùng batch.

```json
{
  "bugs": [
    {
      "externalId": "pmkt-automation:BUG-VATTU-001",
      "confirmed": true,
      "title": "Lưu vật tư không giữ thuế suất đã chọn",
      "preconditions": "Đăng nhập bằng tài khoản có quyền thêm vật tư.",
      "steps": ["Mở form thêm vật tư", "Chọn thuế suất và lưu", "Mở lại vật tư vừa tạo"],
      "expected": "Giữ nguyên thuế suất đã chọn.",
      "actual": "Thuế suất bị đổi về giá trị mặc định.",
      "priority": "high",
      "environment": "staging",
      "branch": "develop",
      "commitSha": "abc123",
      "testCaseIds": ["TC-01", "TC-03"],
      "attachments": [
        { "ref": "screenshot-1", "kind": "screenshot", "fileName": "failure.png", "mimeType": "image/png", "size": 12345 }
      ]
    }
  ]
}
```

Bắt buộc: `externalId`, `confirmed: true`, `title`, `steps` (ít nhất một bước), `expected`, `actual`. Các trường khác tùy chọn; có thêm `description` (text) và `assigneeId` (ID thành viên đang hoạt động trong dự án). Priority: `highest`, `high`, `medium` (mặc định), `low`, `lowest`.

Bug mới có loại `bug`, nguồn `auto`, label `auto`, ghi nhận API key tạo và activity log. Bug chưa được phân sprint/phase, xuất hiện ở Backlog và tab Bug. Vì QC đã xác nhận, dùng trạng thái chấp nhận của workflow, hoặc trạng thái khởi tạo thủ công nếu workflow không có bước duyệt. Không vào Pending Review; nếu workflow không có trạng thái tiếp nhận hợp lệ thì trả lỗi cho mục đó.

API key không đại diện một người dùng cụ thể: reporter để trống, không tự gán tên QC hoặc ghi nhận là Bug tạo thủ công.

HTTP 200 trả kết quả **từng mục**, kể cả khi có mục thất bại:

```json
{
  "projectKey": "PMKT",
  "created": 1,
  "existing": 0,
  "failed": 0,
  "items": [
    {
      "externalId": "pmkt-automation:BUG-VATTU-001",
      "status": "created",
      "issueId": 123,
      "issueKey": "PMKT-123",
      "url": "/browse/PMKT-123",
      "deleted": false,
      "uploads": [
        { "ref": "screenshot-1", "attachmentId": "a-uuid", "uploadUrl": "https://storage.example/signed-upload" }
      ]
    }
  ]
}
```

`url` là đường dẫn tương đối trên web QA Hub. `status` gồm `created`, `existing`, `failed`. Mục `failed` có `error: { statusCode, code, message }`. Client phải đọc `failed`/từng mục, không coi HTTP 200 là tất cả đã thành công. Request sai cấu trúc/thiếu trường trả HTTP 400 trước khi tạo bất kỳ Bug nào.

## Gửi lại và chống tạo trùng

- Giữ nguyên `externalId` cho cùng một Bug; không dùng timestamp/run ID làm mã Bug. Nên thêm prefix tên repo để tránh va chạm trong cùng dự án.
- Cùng dự án và `externalId` luôn trả Bug ban đầu với `status: existing`, kể cả gửi đồng thời hoặc đổi API key. Không ghi đè nội dung đã sửa trên web, không tăng occurrence hoặc tự mở lại Bug.
- Khác dự án có thể dùng cùng ID và tạo Bug độc lập.
- Bug đã xóa mềm vẫn trả `existing` và `deleted: true`; không tự tạo lại hoặc trả upload URL.
- Gửi lại một ID với nội dung hoặc danh sách attachment khác **không cập nhật Bug/không thêm file mới**. Dùng UI để sửa Bug hiện có.
- API không tự phát hiện hai ID khác nhau là cùng nguyên nhân. QC/client quyết định gom nhóm trước khi gửi.
- Khi mất kết nối hoặc nhận lỗi, gửi lại cùng ID; lưu `issueKey` trả về vào dữ liệu local.

## Upload screenshot, video, trace

Tối đa 20 file/Bug; mỗi file tối đa 200 MB. `ref` phải duy nhất trong Bug, `size` là số byte thật. Kind: `screenshot`, `video`, `trace`, `file`.

1. Đọc `uploads` trong từng mục trả về.
2. `PUT` nội dung file vào `uploadUrl`, với `Content-Type` đúng `mimeType`. URL đã ký là quyền upload; không gửi API key QA Hub đến storage.
3. Gọi `POST /api/v1/ingest/bug-attachments/{attachmentId}/complete` với Bearer API key đã tạo file, scope `issues:write`.
4. Server kiểm tra file tồn tại, đúng kích thước và đánh dấu ready; file mới hiển thị trong Bug.

Complete trả HTTP 200 `{ "id": "a-uuid", "status": "ready" }`, gọi lại an toàn. Chưa upload hoặc sai kích thước trả 422; file không thuộc project/API key trả 404; UUID sai trả 400. Gửi lại Bug với cùng ID bằng key ban đầu sẽ lấy lại URL cho file chưa hoàn tất, không tạo Bug mới. Đổi key vẫn chống trùng Bug nhưng không cấp lại URL cho file thuộc key cũ.

## Ví dụ client JavaScript

```js
const response = await fetch(`${process.env.APP_API_URL}/api/v1/ingest/bugs`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.APP_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ bugs: confirmedBugs }),
});
const result = await response.json();
if (!response.ok) throw new Error(JSON.stringify(result));
for (const item of result.items) {
  if (item.status === 'failed') console.warn(item.externalId, item.error);
  else console.log(item.externalId, item.issueKey, item.status);
}
// Nếu có evidence, thực hiện PUT + complete như mô tả trên.
```

Swagger: `/api/docs`, nhóm `ingest`. Hợp đồng này độc lập với `/ingest/runs`; luồng nhận run cũ giữ nguyên.
