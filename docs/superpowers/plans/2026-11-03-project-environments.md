# Project environments

Add a compact Card under general project information, before periods and members. Reuse ListTable numbering/pagination, ActionIconButton tooltips and Ant Design modal/form. One form for view/create/edit; notes stay in details. Fields: name, kind (DEV/SIT/UAT/STAGING/PRODUCTION/OTHER), application/API HTTP(S) URLs, deployed version, optional active project member owner, status (active/maintenance/inactive), notes. No credentials fields or changes to Report.

Reuse project.info.view for reads and project.info.edit for create/update/delete. Enforce project scope, unique active names ignoring case/outer whitespace, valid safe URLs, active same-project owner, optimistic version on updates/delete. Soft delete environments. Record changes in ActivityLog. New additive migration0010 creates project_environments, constraints/indexes/FKs; preserve existing data.

1. Write API integration regressions red: CRUD/read-only permissions, invalid links/owners, duplicate names, stale versions and cross-project isolation.
2. Implement model/migration/DTO/service/controller in projects module; build generated Prisma client, API tests.
3. Add ProjectEnvironments card and wire ProjectInfoPage, API via shared http client. Accessible actions, empty/loading/error states, responsive form, submission guard, fresh draft initialization, confirmation for delete.
4. Browser test real create/view/edit/delete and validation, build/lint, independent code review per requesting-code-review skill. Synchronize OpenAPI/client.
5. Back up local DB, snapshot full existing rows, migrate without reset, restart API/worker, verify on localhost:5173. No commit/push.

## Verification completed

- API environments plus role regressions: 2 suites / 14 tests passed. Covers project scoping, viewer write rejection, stale writes/deletes, URL validation, duplicate names, active-owner options and preserving historical owners.
- Chrome browser create/view/edit/delete workflow passed, including inline unsafe URL validation, owner selection, readonly view and status/version refresh.
- API/web builds and lint passed; OpenAPI and web API client regenerated. Independent review completed; owner-options mismatch fixed and re-reviewed.
- Live PostgreSQL18 backup `var/environment-before-0010.dump`; migration0010 applied. Full-row snapshots confirmed all prior rows in 33 tables unchanged. API/worker restarted. Actual localhost:5173 project info displays the environment card without an application error.
- Existing base components and Report screens preserved. No commits/pushes.
