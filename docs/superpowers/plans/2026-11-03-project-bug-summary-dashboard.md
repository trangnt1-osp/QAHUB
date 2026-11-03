# Project Bug Summary Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the project Summary page into a Bug-only “Report BUG” dashboard with open/all scope, actionable KPIs, and drill-downs by status, Module, Epic, Phase/Sprint, Function, and Priority.

**Architecture:** Extend the existing Summary endpoint with a shared Bug scope SQL predicate and dimension aggregations, then render the typed response through focused dashboard components. Extend the common issue-list filters so every dashboard click reproduces the selected population in Backlog.

**Tech Stack:** NestJS, Prisma/PostgreSQL raw SQL, React 18, Ant Design, Recharts, TanStack Query, Vitest, Jest/Supertest.

**Spec:** `docs/superpowers/specs/2026-11-03-project-bug-summary-dashboard-design.md`

## Global Constraints

- Summary statistics always enforce `type = 'bug'` and `deleted_at IS NULL`.
- Default scope is `open`, defined as workflow status category not equal to `done`; `all` includes done Bug.
- UI title is exactly **Report BUG**.
- Default scope label is **Bug đang mở**; alternate label is **Tất cả Bug**.
- Keep project Recent activity unchanged and independent from Bug scope.
- No new runtime dependencies.

## Review Focus

- A Bug linked to multiple Modules/Functions must count once per group and not duplicate within a group; cover in Task 2 E2E fixtures.
- Unlinked Bug must appear in explicit unassigned groups and drill down accurately; cover in Tasks 1 and 2.
- A workflow with custom status names must still classify open/done by status category; cover in Task 2.
- Projects using Sprint versus Phase must preserve period IDs and display the correct project tracking label; cover in Task 3.
- Empty datasets and deleted structure/period records must render stable labels/counts without crashing; cover in Tasks 2 and 3.

---

### Task 1: Backlog drill-down filters

**Files:**
- Modify: `apps/api/src/issues/issues.dto.ts`
- Modify: `apps/api/src/issues/issues.service.ts`
- Modify: `apps/web/src/features/backlog/BacklogPage.tsx`
- Test: `apps/api/test/workflow-issues.e2e-spec.ts`

**Interfaces:**
- Produces: `ListIssuesQuery.priority?: Priority[]`, `statusCategory?: 'open' | 'done'`, and `createdFrom?: YYYY-MM-DD`.
- Produces: Backlog URL/query-state support for `priority`, `statusCategory`, and `createdFrom`.

- [ ] **Step 1: Write failing API tests** proving `type=bug&priority=highest`, `assigneeIds=unassigned`, `statusCategory=open`, and `createdFrom=<date>` each return exactly their intended Bug rows.
- [ ] **Step 2: Run** `pnpm --filter @ospm/api test:e2e -- workflow-issues.e2e-spec.ts` and verify the new assertions fail because filters are unsupported.
- [ ] **Step 3: Add validated DTO fields and extend `IssuesService.filterWhere(projectId, q)`** with priority membership, status category relation, and inclusive `createdAt >= start-of-day` filtering.
- [ ] **Step 4: Add the three keys to Backlog `FILTER_KEYS` and controls/state parsing** so dashboard URLs survive navigation and are visible/clearable in the filter bar.
- [ ] **Step 5: Re-run the focused E2E test** and expect PASS.

### Task 2: Bug-only Summary API and aggregations

**Files:**
- Modify: `apps/api/src/summary/summary.controller.ts`
- Modify: `apps/api/src/summary/summary.service.ts`
- Modify: `apps/api/test/summary.e2e-spec.ts`

**Interfaces:**
- Consumes: drill-down filters from Task 1.
- Produces: `SummaryScope = 'open' | 'all'` and response fields `scope`, `cards`, `statusOverview`, `byModule`, `byEpic`, `byPeriod`, `byFunction`, `byPriority`, `recentActivity`, `recentActivityNextCursor`.
- Each dimension row produces `{ id: number | null, label: string, count: number }` (priority rows use `{ priority, count }`; status rows retain status metadata).

- [ ] **Step 1: Replace/add failing Summary E2E cases** with Task/Story exclusion, default open Bug scope, `scope=all`, highest/unassigned/new-7d cards, custom done category behavior, multi-link distinct counts, unlinked groups, Epic parent, and deleted structure labels.
- [ ] **Step 2: Run** `pnpm --filter @ospm/api test:e2e -- summary.e2e-spec.ts` and verify failures reflect the old all-item response.
- [ ] **Step 3: Extend `SummaryQuery` and `parseSummaryFilter`** with validated `scope`, defaulting to `open`.
- [ ] **Step 4: Refactor summary SQL around one shared Bug predicate** and implement the four cards plus status, Module, Epic, period, Function, and Priority aggregations with `count(distinct issue_id)` where joins are many-to-many.
- [ ] **Step 5: Preserve existing activity output** without applying Bug/scope filters.
- [ ] **Step 6: Re-run Summary E2E tests** and expect PASS.

### Task 3: Report BUG dashboard UI

**Files:**
- Create: `apps/web/src/features/summary/SummaryPage.test.tsx`
- Create: `apps/web/src/features/summary/BugBreakdown.tsx`
- Modify: `apps/web/src/features/summary/SummaryPage.tsx`

**Interfaces:**
- Consumes: Task 2 summary response and Task 1 Backlog query keys.
- Produces: `BugBreakdown` ranked clickable list and the complete Report BUG dashboard.

- [ ] **Step 1: Write failing component tests** asserting default `scope=open`, toggle to `all`, title “Report BUG”, four KPI values, all six breakdowns, empty state, Phase/Sprint label, and drill-down URLs that always contain `type=bug` plus the clicked filter.
- [ ] **Step 2: Run** `pnpm --filter @ospm/web test -- SummaryPage.test.tsx` and verify expected failures against the old Summary UI.
- [ ] **Step 3: Implement `BugBreakdown`** as a responsive ranked bar/list accepting rows and an `onSelect` callback, including unlinked rows and multi-link count note.
- [ ] **Step 4: Rebuild `SummaryPage`** with typed response interfaces, segmented open/all scope, existing assignee/source filters, four clickable KPI cards, status donut, Module/Epic/period/Function/Priority breakdowns, responsive layout, and unchanged activity card.
- [ ] **Step 5: Implement one URL builder** that merges `type=bug`, scope-derived `statusCategory=open` when needed, current assignee/source filters, and clicked dimension filters before navigating to Backlog.
- [ ] **Step 6: Re-run focused frontend tests** and expect PASS.

### Task 4: Contract regeneration and complete verification

**Files:**
- Modify generated OpenAPI/client artifacts only if `pnpm openapi && pnpm api:gen` changes them.
- Verify all files changed in Tasks 1–3.

**Interfaces:**
- Consumes: final backend contract and frontend implementation.
- Produces: synchronized generated artifacts and verified local application.

- [ ] **Step 1: Run** `pnpm openapi` then `pnpm api:gen`; inspect generated diffs and keep only contract-derived changes.
- [ ] **Step 2: Run API typecheck and focused E2E tests:** `pnpm --filter @ospm/api build`, Summary E2E, and workflow issue E2E; expect PASS.
- [ ] **Step 3: Run frontend focused tests and production build:** `pnpm --filter @ospm/web test -- SummaryPage.test.tsx` and `pnpm --filter @ospm/web build`; expect PASS.
- [ ] **Step 4: Run complete repository verification:** `pnpm typecheck`, `pnpm test`, and any serial frontend fallback needed for known parallel timeout sensitivity; report every pre-existing warning/failure explicitly.
- [ ] **Step 5: Smoke-test local FE/BE** by requesting `/`, `/api/docs`, and a logged-in Summary request; verify HTTP success and the dashboard query response shape.

## Self-review

- Spec coverage: every KPI, scope, dimension including Epic, activity, access assumption, responsive/empty state, and drill-down is owned by a task.
- Type consistency: `scope`, dimension field names, and Backlog query keys match across Tasks 1–3.
- Review focus: all five high-risk data cases are pinned to tests.
- Proportion: implementation details are expressed as interfaces and observable tests, not copied program bodies.
