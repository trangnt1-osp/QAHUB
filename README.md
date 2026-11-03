# OSPM — Quản lý dự án & bug tự động

Ứng dụng nội bộ kiểu Jira cho ~10 người dùng. Điểm khác biệt: bug có thể **tạo tự động từ kết quả Playwright** qua API
(repo Playwright là dự án riêng), và **workflow trạng thái cấu hình riêng cho từng dự án**.
Đặc tả gốc: `Đặc tả gen code — Hệ thống quản lý dự án & bug tự động (1).md`.

## Kiến trúc

Monorepo pnpm + Turborepo, TypeScript strict.

```text
apps/api        NestJS 10 + Prisma 5 + PostgreSQL 16; 2 entrypoint: main.ts (HTTP) và worker.ts (pg-boss)
apps/web        React 18 + Vite 5 + Ant Design 5 (SPA); client API sinh bằng Orval từ openapi.json
packages/shared enum, mã lỗi, LexoRank, template workflow dùng chung (build CJS + ESM)
docs/integration  hướng dẫn cho repo Playwright + example-reporter.ts + openapi.json
scripts/simulate-ingest.ts  giả lập repo Playwright gửi một lần chạy
docker/ docker-compose.yml  nginx, api, worker, postgres, minio
```

Menu chính: Dashboard · Dự án (Thông tin dự án / Summary / Backlog / Active sprint hoặc Active phase / Test cases) · Member · Report · API Keys · Cấu hình.

Quản trị hệ thống có thêm menu **Vai trò** để tạo vai trò tùy chỉnh và chọn quyền theo menu, tab/mục thông tin và thao tác. Có thể sửa quyền của cả các vai trò mặc định Admin/Developer/Tester/Viewer; tên/mã và việc xóa các vai trò mặc định được bảo vệ. Thay đổi áp dụng cho thành viên hiện có trong mọi dự án, còn quản trị hệ thống luôn giữ toàn quyền. Mẫu QC ban đầu chỉ có quyền xem. Vào **Thông tin dự án → Thành viên dự án → Vai trò** hoặc sửa người dùng để gán vai trò riêng cho từng người trong từng dự án. Quyền xem độc lập với thêm/sửa/xóa, bắt đầu/hoàn thành Sprint/Phase, import/export và các thao tác khác. Quyền phụ thuộc được bổ sung tự động; không thể gán quyền vượt quá quyền của người đang gán. Vai trò đã được dùng trong lịch sử thành viên không được xóa.

Menu/tab và nút thao tác sử dụng cùng danh mục quyền với API; đường dẫn trực tiếp và yêu cầu hàng loạt cũng được kiểm tra. Quyền được đọc lại ở mỗi yêu cầu API, kể cả tệp đính kèm và tác vụ nền. Giao diện tải lại quyền khi cửa sổ được focus hoặc mỗi 30 giây; thay đổi quyền xóa cache cũ. Metadata phục vụ các màn được phép xem dùng endpoint runtime/options riêng, không mở quyền xem menu Cấu hình hay chi tiết thành viên. Import là thao tác thêm/cập nhật hàng loạt và yêu cầu các quyền sửa cấu trúc/category/liên kết tương ứng. Quản lý người dùng toàn hệ thống và định nghĩa vai trò chỉ dành cho quản trị hệ thống.

Trong **Thông tin dự án → Quản lý Sprint / Phase**, quản trị viên chọn cách theo dõi của dự án. Developer trở lên có thể tạo, sửa, bắt đầu và hoàn thành Sprint/Phase tại đây hoặc tạo nhanh trong Backlog; các màn dùng chung dữ liệu. Sprint chỉ có một phiên đang chạy; Phase cho phép chạy song song và chọn giai đoạn cần xem trên Active. Phase chỉ hoàn thành khi các item hiện có đã xong. Không được xóa Sprint/Phase còn item liên kết (kể cả đã hoàn thành hoặc xóa mềm), hoặc đổi cách theo dõi khi còn phân bổ/đang chạy. Dự án hiện có mặc định theo Sprint.

File đính kèm (ảnh/video/log) mặc định lưu **trên đĩa máy chủ API** (`STORAGE_DRIVER=local`), không cần MinIO/S3.
Có thể đổi sang MinIO/S3 bằng `STORAGE_DRIVER=s3`. Xem mục [Lưu trữ file đính kèm](#lưu-trữ-file-đính-kèm).

---

# 🚀 Chạy ở local sau khi pull code (hướng dẫn bàn giao)

Hai cách. Nếu máy có Docker, **Cách A nhanh nhất**. Không có Docker thì theo **Cách B**.

## Cách A — Docker Compose (nhanh nhất, 1 lệnh)

Yêu cầu: Docker Desktop (hoặc Docker Engine + compose plugin).

```bash
cp .env.example .env            # đổi JWT_SECRET, JWT_REFRESH_SECRET, SEED_ADMIN_PASSWORD...
docker compose up -d --build    # postgres + minio + api + worker + nginx(web)
docker compose exec api pnpm --filter @ospm/api seed   # nạp dữ liệu mẫu (project ELMS, DEMO)
```

- Web: **http://localhost:8080** · Swagger: **http://localhost:8080/api/docs** · MinIO console: http://localhost:9001
- `api` tự chạy `prisma migrate deploy` khi khởi động.
- Bản Docker dùng MinIO cho file đính kèm (`STORAGE_DRIVER=s3`, đã set sẵn trong compose).

Dừng: `docker compose down` (thêm `-v` để xoá luôn dữ liệu Postgres/MinIO).

---

## Cách B — Chạy trực tiếp trên máy (dev, không cần Docker)

### B0. Yêu cầu

| Phần mềm | Phiên bản | Ghi chú |
|---|---|---|
| Node.js | 20+ (đã test trên 24) | https://nodejs.org |
| pnpm | 9.x | Bật bằng `corepack enable` (repo đã ghim `pnpm@9.14.2`) |
| PostgreSQL | **16** | Bắt buộc 16 (migration dùng collation `"C"`). macOS: `brew install postgresql@16` |

> **Không cần MinIO/S3** — file đính kèm lưu trên đĩa.

### B1. Cài dependencies & build package dùng chung

```bash
corepack enable          # nếu chưa có pnpm
pnpm install
pnpm --filter @ospm/shared build    # BẮT BUỘC trước khi chạy api/web (chúng import @ospm/shared)
```

### B2. Tạo file `.env`

```bash
cp .env.example .env
```

Mở `.env` và chỉnh (tối thiểu):

```ini
# Trỏ tới Postgres của bạn — PORT phải trùng Postgres bạn chạy ở B3
DATABASE_URL=postgresql://ospm:ospm@localhost:5432/ospm

# Đổi thành chuỗi ngẫu nhiên dài khi bàn giao
JWT_SECRET=change-me-access
JWT_REFRESH_SECRET=change-me-refresh

# Kho file đính kèm: để 'local' là xong, không cần MinIO
STORAGE_DRIVER=local
STORAGE_DIR=./var/storage                 # thư mục lưu file (tự tạo). Chạy từ apps/api nên là apps/api/var/storage
STORAGE_PUBLIC_URL=http://localhost:3000  # base URL API để tạo link tải file

SEED_ADMIN_PASSWORD=Admin@12345           # mật khẩu tài khoản admin seed
PORT=3000
WEB_ORIGIN=http://localhost:5173
```

> ⚠️ **Quan trọng — nạp `.env` vào terminal.** App đọc biến môi trường trực tiếp (không tự load `.env`).
> Vì vậy **ở MỖI terminal**, trước khi chạy bất kỳ lệnh `pnpm` nào bên dưới, hãy nạp `.env`:
>
> ```bash
> set -a; source .env; set +a      # bash/zsh — chạy tại thư mục gốc repo
> ```
>
> (Hoặc cài [`direnv`](https://direnv.net) để tự nạp. Trên Windows nên dùng WSL hoặc Cách A/Docker.)

### B3. Chuẩn bị PostgreSQL 16

Tạo user + database **đúng như `DATABASE_URL`** (ví dụ `ospm/ospm/ospm`).

**macOS (Homebrew):**
```bash
brew services start postgresql@16
PG=/opt/homebrew/opt/postgresql@16/bin   # Intel: /usr/local/opt/postgresql@16/bin
"$PG/psql" -d postgres -c "CREATE ROLE ospm LOGIN PASSWORD 'ospm';"
"$PG/psql" -d postgres -c "CREATE DATABASE ospm OWNER ospm;"
```

**Hoặc chạy nhanh Postgres 16 bằng Docker (chỉ mỗi DB):**
```bash
docker run -d --name ospm-pg -p 5432:5432 \
  -e POSTGRES_USER=ospm -e POSTGRES_PASSWORD=ospm -e POSTGRES_DB=ospm postgres:16
```

> Nếu Postgres chạy ở cổng khác 5432, sửa cổng trong `DATABASE_URL` cho khớp.
> Kiểm tra kết nối: `pg_isready -h localhost -p 5432`.

### B4. Tạo schema + dữ liệu mẫu

```bash
set -a; source .env; set +a        # nếu terminal này chưa nạp
pnpm db:migrate                    # chạy prisma migrate deploy (tạo bảng + collation LexoRank)
pnpm db:seed                       # 3 template workflow + admin + dữ liệu mẫu (ELMS, DEMO)
```

### B5. Chạy 3 tiến trình (mỗi cái 1 terminal — nhớ nạp `.env` ở đầu mỗi terminal)

```bash
# Terminal 1 — API (HTTP :3000, Swagger /api/docs)
set -a; source .env; set +a
pnpm --filter @ospm/api dev

# Terminal 2 — Worker pg-boss (xử lý lần chạy Playwright, export Excel, dọn dẹp)
set -a; source .env; set +a
pnpm --filter @ospm/api dev:worker

# Terminal 3 — Web (Vite :5173, proxy /api → :3000)
set -a; source .env; set +a
pnpm --filter @ospm/web dev
```

### B6. Mở ứng dụng

- Web: **http://localhost:5173**
- Swagger: **http://localhost:3000/api/docs**

**Tài khoản đăng nhập (sau khi seed):**

| Tài khoản | Mật khẩu | Vai trò |
|---|---|---|
| `admin@local.test` | giá trị `SEED_ADMIN_PASSWORD` trong `.env` | Quản trị hệ thống |
| `lead@local.test` | `Password1!` | Lead dự án |
| `dev1@local.test` · `dev2@local.test` | `Password1!` | Developer |
| `tester1@local.test` · `tester2@local.test` | `Password1!` | Tester |
| `viewer@local.test` | `Password1!` | Viewer |

---

## Lưu trữ file đính kèm

- Mặc định `STORAGE_DRIVER=local`: file nằm trong `STORAGE_DIR` (mặc định `apps/api/var/storage`), đặt tên theo
  `PROJECT/entity/id/<uuid>-<tên file>`. Thư mục này đã được `.gitignore`.
- Link upload/tải là URL ký HMAC (`/api/v1/blob/<token>`, hết hạn 1 giờ) nên trình duyệt và repo Playwright
  PUT/GET thẳng, y hệt luồng presigned của S3 — **không phải sửa code client**.
- Đổi sang MinIO/S3: đặt `STORAGE_DRIVER=s3` và khai báo `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`,
  `S3_BUCKET_ATTACHMENTS`, `S3_PUBLIC_ENDPOINT`.

**Khi deploy VPS (dùng kho local):** đặt `STORAGE_DIR` trỏ tới volume cố định (vd `/var/lib/ospm/storage`) và
`STORAGE_PUBLIC_URL=https://<domain>` (nginx định tuyến `/api` → api). Nếu chạy api + worker ở **2 container
tách biệt**, cả hai phải **mount chung** volume đó, nếu không file export/đính kèm sẽ không thấy nhau — khi đó
`docker-compose.yml` hiện vẫn để `STORAGE_DRIVER=s3` (MinIO) để tránh vấn đề này; chuyển sang local cần thêm volume dùng chung.

---

## Sau khi sửa API (đồng bộ client web)

```bash
pnpm openapi     # xuất apps/api/openapi.json + docs/integration/openapi.json
pnpm api:gen     # Orval sinh lại apps/web/src/api/generated
```

Seed lớn để đo hiệu năng: `pnpm db:seed:large` (dự án `PERF`: 20.000 item, 50.000 test case, một function 10.000 case).

---

## Xử lý sự cố thường gặp

| Triệu chứng | Nguyên nhân & cách khắc phục |
|---|---|
| `Environment variable not found: DATABASE_URL` | Terminal chưa nạp `.env`. Chạy `set -a; source .env; set +a` rồi thử lại. |
| `P1001: Can't reach database server at localhost:<port>` | Postgres chưa chạy hoặc sai cổng. Khởi động Postgres 16 và đảm bảo cổng trùng `DATABASE_URL` (`pg_isready -h localhost -p <port>`). |
| `relation ... does not exist` / lỗi khi seed | Chưa chạy `pnpm db:migrate` trước `pnpm db:seed`. |
| Lỗi import `@ospm/shared` khi chạy api/web | Chưa build shared. Chạy `pnpm --filter @ospm/shared build`. |
| Ảnh đính kèm không hiển thị | Dùng `STORAGE_DRIVER=local`, kiểm tra `STORAGE_PUBLIC_URL` đúng (`http://localhost:3000` khi dev). Nếu từng lỗi, hard-refresh trình duyệt (Cmd/Ctrl+Shift+R) để bỏ cache ảnh hỏng. |
| `Port 3000/5173 already in use` | Có tiến trình cũ còn chạy. Tắt nó (`lsof -i :3000`) hoặc đổi `PORT`. |
| pnpm báo sai phiên bản | `corepack enable` để dùng đúng `pnpm@9.14.2` đã ghim. |

---

## Kiểm thử

```bash
# Backend: unit + integration (Jest + Supertest). Mặc định bật Postgres 16 bằng Testcontainers (cần Docker);
# không có Docker thì trỏ vào một DB trống:
TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/ospm_test pnpm --filter @ospm/api test

pnpm --filter @ospm/shared test            # LexoRank
pnpm --filter @ospm/web test               # Vitest + Testing Library

# E2E (Playwright): cần build API trước; DB riêng được tạo lại + seed ở global-setup
pnpm --filter @ospm/api build
E2E_DATABASE_URL=postgresql://user:pass@localhost:5432/ospm_e2e pnpm --filter @ospm/web exec playwright test
```

Integration test chạy queue ở chế độ `QUEUE_MODE=inline` (job chạy ngay trong tiến trình) và thay kho file bằng bản giả.

## Tích hợp Playwright

Xem `docs/integration/playwright.md` (luồng 3 bước, fingerprint, lỗi, retry) và `docs/integration/example-reporter.ts`.
Thử nhanh: tạo API key ở menu **API Keys** rồi

```bash
APP_API_URL=http://localhost:3000 APP_API_KEY=pmk_live_... pnpm simulate-ingest --fail 3 --flaky 1
```

## Quy ước chính

- DB `snake_case`, JSON `camelCase`; mã item `{KEY}-{số}`; prefix API `/api/v1`; lỗi `{ statusCode, code, message, details? }`.
- Phân trang cursor `?cursor=&limit=` → `{ items, nextCursor }`; chống ghi đè bằng `version` (409 `VERSION_CONFLICT`).
- Trạng thái là dữ liệu theo dự án; board = trạng thái không lưu trữ, `show_on_board` và **không thuộc category `triage`**.
- API key chỉ lưu `sha256`; mỗi key gắn một dự án, có scope, hạn dùng, thu hồi được.
- LexoRank dùng collation `"C"` (migration `0002_rank_collation`) để thứ tự đúng và nhanh trên mọi locale.

## Ghi chú / TODO (chỗ đặc tả chưa rõ, đã chọn cách đơn giản nhất)

- **Layout file Excel** import/export suy ra từ mô tả mẫu checklist (vì chưa có file mẫu gốc): xem comment đầu
  `apps/api/src/test-cases/excel.service.ts`. Cần đối chiếu với file thật của đội QA.
- Response API chưa khai báo schema Swagger đầy đủ nên Orval sinh kiểu response là `any`
  (`apps/web/scripts/patch-generated.mjs`); kiểu hiển thị dùng ở `apps/web/src/api/models.ts`.
- Job tạo **thumbnail** ảnh (nhắc ở mục 3) chưa làm: giao diện dùng ảnh gốc qua link đã ký.
- Test case: di chuyển sang function khác **giữ nguyên `code`** (định danh gắn với tag automation) và cấp `seq` mới.
- Thông báo email/Slack, SSO, test run thủ công, tab Timeline/Reports/Releases nằm ngoài MVP.
