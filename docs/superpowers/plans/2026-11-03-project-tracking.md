# Project Sprint / Phase Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans task by task.

**Goal:** Manage Sprint or Phase in project information and quick-create in Backlog, with synchronized Active views.

**Architecture:** Add project trackingMode (sprint default / phase) and explicit kind on existing work-period records. Keep the existing sprint allocation IDs and API contracts compatible; the selected project mode determines new record kind. Sprint and Phase retain distinct rules: one active sprint, parallel active phases, phase completion requires all items done. Use the same list endpoint and React Query keys in every view.

**Tech Stack:** NestJS, Prisma/PostgreSQL, React, Ant Design, TanStack Query.

**Spec:** User requirements in this conversation: create/edit/delete periods in project information, retain quick create in Backlog, synchronize Backlog/Active, prevent deletion of linked periods; metadata edits remain allowed.

## Constraints
- Preserve existing data and base components; no Report changes.
- Existing projects and periods default to sprint.
- All issue types count as linked, including done and soft-deleted records.
- Mode changes require no allocations and no active periods; existing empty inactive periods retained by kind.
- Period deletion must be safe against concurrent allocation; validate allocations within transactions.

## Review Focus
- Viewer permissions and cross-project allocation are rejected by the API.
- Done items still prevent deletion.
- Parallel phases appear individually on Active with a selector.
- Date validation includes partial updates and invalid calendar dates.
- Cached views update after every creation/edit/mode change.

## Tasks
- [x] Backend: failing integration tests; migration, mode DTOs, period list/lifecycle, allocation validation and concurrency guards, board selection.
- [x] Project information UI: mode control, numbered paginated management list, creation and existing lifecycle dialogs.
- [x] Backlog/Active UI: dynamic terminology and quick creation, parallel active-phase selector, issue editor labels.
- [x] Verify: migration, API/web checks, integration and browser flows, review, update documentation.

## Verification
- API full suite: 12 suites, 90 tests passed; final focused tracking suite: 5 tests passed, including allocation/deletion and simultaneous sprint starts.
- Web unit tests: 14 passed. API and web ESLint passed. API and web production builds passed.
- Browser: project tracking and quick-create Sprint passed; project navigation and both quick-search scenarios passed.
- Review fixed stale Active selection and management counts; no remaining blocker.
- Applied additive migration 0005 to local database; API and web health HTTP 200; local API and worker restarted.

## Rulings
- Reuse existing allocation infrastructure with explicit kind rather than duplicate every issue operation; API/storage names stay compatible while UI terminology follows project mode.
- Phase completion blocks unfinished items; sprint completion retains its carry-over behavior.
- Do not commit or change unrelated working-tree files.
- Phase completion checks current items at completion time. Existing item workflow transitions continue to govern later reopens, consistent with existing sprint history.
- When the selected active phase is completed, Active falls back to another active phase rather than displaying an empty board.
