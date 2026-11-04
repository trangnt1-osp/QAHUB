# Project Masterplan Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a standalone Masterplan project tab for delivery milestones without changing existing project pages or reporting behavior.

**Architecture:** Add project-scoped milestone records and feature links, with dates, owner, acceptance criteria, status and manual progress. Use the existing project.info.view/edit permissions and existing React Query, Ant Design, NestJS and Prisma patterns.

**Scope:** The approved conversation places Masterplan after Project information. Existing Summary, Report, Sprint/Phase and feature behavior stays untouched. Progress is explicitly entered manually; no automatic reporting or baseline versioning in this addition.

## Tasks

- [x] Add API integration regression tests for CRUD, date validation, project isolation, feature/owner membership and optimistic concurrency.
- [x] Add an additive Prisma migration, DTOs, project-scoped service and controller. Audit changed field names, not arbitrary payloads.
- [x] Add a standalone Masterplan page with milestone list, create/edit/delete, filters, overdue indicators and owner/feature options. Register only the new tab.
- [x] Test UI interactions and read-only access; verify API tests against a dedicated test database, compile both apps and inspect the local page.
- [x] Deploy the additive migration locally, restart API/worker with the current build, and verify existing project tabs remain available.

## Review focus

- Date-only values must retain their calendar dates; end dates cannot precede start dates.
- Owners/features from another project cannot be assigned.
- Updates and deletes must match the current record version and project.
- Removing a milestone must not delete linked features, issues or periods.
- Project changes must not reuse stale editor state; mutations invalidate only Masterplan queries.

## Verification

- API: 3 integration tests passed against the dedicated test database, including CRUD, optimistic concurrency, permission enforcement, invalid/null input, cross-project references and preservation of historical feature links.
- UI: 4 tests passed for milestone display, manual progress, edit payload/version, read-only access and conflict refresh.
- Web TypeScript check and API build passed. Migration 0012 applied locally; API and worker restarted successfully.
- Browser: Masterplan is immediately after Project information; all existing tabs remain. Creation form and empty state inspected without creating sample project data.
- Independent review completed; all three reported correctness issues fixed and rechecked.

## Decisions

- Execute in the current workspace to update the running local application; no branch, merge or commit requested.
- Reuse project.info.view/edit rather than changing permission definitions for existing roles.
- Initial edit endpoint accepts full-record form updates with a required name and version.
- No changes to existing reporting calculations, Summary, Sprint/Phase, backlog or feature behavior.
