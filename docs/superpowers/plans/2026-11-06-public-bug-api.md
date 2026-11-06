# Public confirmed Bug API

**Goal:** External automation clients submit QC-confirmed Bugs directly without sending runs or using AI.

**Architecture:** Extend API-key-authenticated ingest with POST /api/v1/ingest/bugs (issues:write). Each Bug is transactional, project-scoped and idempotent by externalId. Reuse issue numbering, ranking, workflow, activity and attachment storage. No schema migration: use a namespaced external-ID fingerprint, serialized by the existing project row lock.

**Contract:** 1–100 Bugs per batch; explicit confirmed=true; stable externalId; title, steps, expected and actual required. Optional priority, context and attachments. Imported source is auto with API-key provenance, using the project's accepted status (or initial manual status), never Pending Review. Existing IDs return the original issue without modifying it, including soft-deleted issues. Validation rejects malformed batches; per-item business errors are returned independently. Upload evidence via returned signed URLs and authenticated completion endpoint.

## Tasks

- [x] Write failing HTTP tests for auth, scope, validation, creation, workflow, idempotency/concurrency, project isolation, partial failures and attachments.
- [x] Implement validated DTO, transactional service and ingest routes.
- [x] Document requests, responses, retries and evidence upload.
- [x] Run tests against a new isolated test database, compile API and check diff.

Work in the current local workspace; preserve unrelated edits and automation submodule.

Validation: 21 HTTP e2e tests passed across public-bugs and existing ingest suites on a dedicated local test database. Production TypeScript check and Nest build passed. Full-project typecheck exposes existing readonly-array errors in automation/fingerprint.spec.ts, outside this change. Independent read-only review found no critical/important blockers. Updated the published OpenAPI contract for the two new endpoints and their DTOs only. Restarted local API with its existing .env; verified POST without key returns 401 and both operations appear in live Swagger. No application database schema or data changes were needed.
