# Tích hợp Playwright → OSPM (tạo bug tự động)

> Nếu QC đã xác nhận Bug và chỉ muốn gửi thông tin Bug (không gửi cả lần chạy, không cần AI), dùng [API đẩy Bug trực tiếp](./public-bugs.md) với scope `issues:write`.

Tài liệu cho **đội repo Playwright**. Repo OSPM chỉ cung cấp API; reporter do repo Playwright tự viết và duy trì
(bản mẫu sao chép được: [`example-reporter.ts`](./example-reporter.ts)).

- Hợp đồng API (OpenAPI): [`openapi.json`](./openapi.json) — hoặc `GET /api/docs-json`; giao diện Swagger tại `/api/docs`.
- Phiên bản ổn định `/api/v1`. Thay đổi phá vỡ tương thích sẽ ra `/api/v2`.

## 1. Chuẩn bị

1. Admin dự án vào menu **API Keys**, bấm **Tạo API key** (chọn scope `runs:write`, hạn dùng). Key dạng `pmk_live_…`
   **chỉ hiện một lần** — lưu ngay vào biến bí mật của CI.
2. Trong CI của repo Playwright đặt 2 biến môi trường:

   | Biến | Ví dụ |
   | --- | --- |
   | `APP_API_URL` | `https://ospm.company.local` |
   | `APP_API_KEY` | `pmk_live_…` |

3. Kiểm tra cấu hình: `curl -H "Authorization: Bearer $APP_API_KEY" $APP_API_URL/api/v1/ingest/ping`
   → `{"projectKey":"ELMS","keyName":"GitLab CI - nightly","scopes":["runs:write"]}`

Mỗi key gắn với **một dự án**; mọi dữ liệu gửi lên luôn thuộc dự án đó. Key đã thu hồi/hết hạn bị từ chối.

## 2. Luồng gửi một lần chạy (3 bước)

Gửi **cả lần chạy** một lần (không gọi API cho từng test fail). Việc gom nhóm và tạo bug chạy nền ở server.

```text
1. POST /api/v1/ingest/runs                    → 201 { runId, status: "receiving", uploads: [{ref, attachmentId, uploadUrl}] }
2. PUT  <uploadUrl>   (từng file, thẳng lên MinIO)
3. POST /api/v1/ingest/runs/{runId}/complete   → 202 { runId, status: "processing" }
   (tuỳ chọn) GET /api/v1/ingest/runs/{runId}  → tóm tắt + link trang Report
```

Mọi request kèm `Authorization: Bearer <APP_API_KEY>`.

### Bước 1 — body

```json
{
  "externalId": "gitlab-pipeline-88213",
  "name": "Nightly regression",
  "branch": "develop",
  "commitSha": "9f2c1ab",
  "environment": "staging",
  "ciUrl": "https://gitlab.company.local/elms/-/pipelines/88213",
  "startedAt": "2026-11-01T17:00:00Z",
  "finishedAt": "2026-11-01T17:24:10Z",
  "results": [
    {
      "testId": "a1b2c3-d4e5",
      "file": "tests/student/exam.spec.ts",
      "line": 42,
      "titlePath": ["Học sinh", "Bài kiểm tra", "Điểm số hiển thị trong bảng lịch sử"],
      "browser": "chromium",
      "status": "failed",
      "retries": 2,
      "durationMs": 15320,
      "error": { "message": "expect(locator).toHaveText(...) failed", "stack": "...", "snippet": "..." },
      "tags": ["@regression", "@CL_NDS-U-00796-020"],
      "attachments": [
        { "ref": "att-1", "kind": "screenshot", "fileName": "test-failed-1.png", "mimeType": "image/png", "size": 182334 }
      ]
    }
  ]
}
```

| Trường | Ghi chú |
| --- | --- |
| `externalId` | **Bắt buộc**, ví dụ ID pipeline CI. Dùng cho idempotency. |
| `results[].status` | `passed` \| `failed` \| `timedOut` \| `skipped` \| `interrupted` (server tự suy ra `flaky` khi `passed` và `retries > 0`) |
| `titlePath` | Mảng tên describe/test (không gồm project và file) |
| `attachments[].kind` | `screenshot` \| `video` \| `trace` \| `file` |
| Giới hạn | tối đa `INGEST_MAX_RESULTS_PER_RUN` (mặc định 5000) kết quả/lần chạy; mỗi file ≤ 200 MB; body JSON ≤ 20 MB |

Chỉ kết quả **không `passed`** mới được cấp upload URL (giảm dung lượng). Response:

```json
{ "runId": 45, "status": "receiving", "uploads": [ { "ref": "att-1", "attachmentId": "5b1e…", "uploadUrl": "https://minio…" } ] }
```

### Bước 2 — upload

`PUT` nội dung file lên `uploadUrl` với header `Content-Type` đúng `mimeType`. Upload hỏng thì **bỏ qua file đó**, đừng làm fail pipeline.

### Bước 3 — complete

Server đẩy job `automation.process-run` vào hàng đợi (Worker). Gọi nhiều lần vẫn chỉ xử lý một lần.

## 3. Server làm gì với dữ liệu

- **Fingerprint** = `sha256(projectId | file | titlePath | dòng đầu thông báo lỗi đã chuẩn hóa)`. Số, uuid, thời gian chờ, mã màu ANSI
  được chuẩn hóa; **browser không nằm trong fingerprint** — cùng lỗi trên Chromium và Firefox chỉ ra **một** bug.
- Fingerprint **đã có bug đang mở**: tăng `occurrence_count`, thêm comment hệ thống "Xuất hiện lại ở run #…", **không tạo bug mới**.
- Bug cùng fingerprint **đã đóng (done)**: tạo bug mới ở Pending Review, liên kết `regression_of` tới bug cũ.
- Bug cùng fingerprint **đã bị Reject**: không tạo bug, chỉ tăng `occurrence_count`.
- Test **flaky** (pass sau retry): không tạo bug (admin dự án có thể bật "Tạo bug cho test flaky" ở Cấu hình → Chung).
- Mọi bug auto mới ở trạng thái khởi tạo auto của dự án (mặc định **Pending Review**), có label `auto`, `source = auto`.
  Tester duyệt (Accept / Reject / Duplicate) trước khi bug vào sprint; Pending Review không bao giờ hiện trên board.
- Test gắn tag dạng `@CL_NDS-U-00796-020` sẽ hiển thị cùng checklist tương ứng ở tab Test cases.

## 4. Idempotency và retry

- Gửi lại cùng `externalId` → `200` trả run cũ, **không tạo trùng**. Run còn `receiving` thì nhận lại upload URL cho file chưa upload;
  run đã `completed` thì `uploads` rỗng.
- `POST …/complete` gọi lại an toàn.
- Giới hạn **60 request/phút cho mỗi key** (quá giới hạn → `429 RATE_LIMITED`).

## 5. Lỗi

Mọi lỗi có dạng `{ "statusCode": 401, "code": "API_KEY_REVOKED", "message": "…", "details"?: … }`. Hãy log `code`.

| HTTP | `code` | Ý nghĩa |
| --- | --- | --- |
| 401 | `API_KEY_INVALID` | Thiếu/sai key |
| 401 | `API_KEY_REVOKED` | Key đã bị thu hồi |
| 401 | `API_KEY_EXPIRED` | Key hết hạn |
| 403 | `API_KEY_SCOPE` | Key thiếu scope `runs:write` |
| 400 | `VALIDATION_ERROR` | Body sai định dạng (`details` liệt kê lỗi) |
| 413 | `RUN_TOO_LARGE` | Vượt `INGEST_MAX_RESULTS_PER_RUN` |
| 404 | `RUN_NOT_FOUND` | `runId` không thuộc dự án của key |
| 429 | `RATE_LIMITED` | Quá 60 request/phút |

Reporter **không được làm fail pipeline** khi gửi báo cáo lỗi: bắt mọi exception và chỉ `console.warn` (bản mẫu đã làm vậy).

## 6. Dùng reporter mẫu

1. Sao chép [`example-reporter.ts`](./example-reporter.ts) vào repo Playwright (ví dụ `reporters/bug-tracker-reporter.ts`).
2. Trong `playwright.config.ts`:

   ```ts
   export default defineConfig({
     reporter: [['list'], ['./reporters/bug-tracker-reporter.ts']],
     use: { screenshot: 'only-on-failure', video: 'retain-on-failure', trace: 'retain-on-failure' },
   });
   ```

3. CI đặt `APP_API_URL`, `APP_API_KEY` (và tuỳ chọn `CI_PIPELINE_ID`, `CI_COMMIT_REF_NAME`, `CI_COMMIT_SHORT_SHA`, `TEST_ENV`).
   Thiếu `APP_API_URL`/`APP_API_KEY` thì reporter im lặng bỏ qua (chạy local không gửi).

## 7. Thử nhanh không cần repo Playwright

Trong repo OSPM có script giả lập một lần chạy:

```bash
APP_API_URL=http://localhost:3000 APP_API_KEY=pmk_live_… pnpm simulate-ingest --fail 3 --flaky 1
# chạy lại với cùng lỗi → occurrence_count tăng, không có bug mới
# chạy lại cùng --external-id → 200, không tạo trùng
```
