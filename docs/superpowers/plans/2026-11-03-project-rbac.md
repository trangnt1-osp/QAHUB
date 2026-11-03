# Project role management implementation plan

> Use superpowers:subagent-driven-development and requesting-code-review. No commits requested.

**Goal:** Assign configurable roles per project; enforce menu, section and operation permissions in both UI and API while reusing existing base components.

**Architecture:** One shared permission catalog with explicit prerequisites. Keep the four built-in roles immutable and compatible; add global reusable role definitions plus nullable roleId on project memberships. Custom assignments store legacy viewer as a compatibility marker, but authorization uses only the definition's current permission array. System administrators retain full access. Roles are managed by system administrators and assigned by authorized project member managers.

**Stack:** Existing NestJS/Prisma/PostgreSQL, React/Ant Design, React Query/Zustand.

**Spec:** Approved conversation: QC may view project information but cannot edit it or access Settings; Backlog, Active, Test cases and their actions can be granted separately. Same person can have different roles in different projects. Direct links and API calls must honor permission changes.

## Tasks
- [x] Shared catalog and prerequisites, backend role model/migration/CRUD with QC view preset.
- [x] Central permission guard, membership assignment, live auth payload, safe metadata lookups, bulk payload and attachment/job boundaries.
- [x] Role management UI using base table/icons/forms; project member role selection.
- [x] Route/menu/section guards and granular action controls, cache cleanup and permission refresh.
- [x] Integration and browser tests, migration/builds/lint, independent review and local services restored.

## Constraints and rulings
- Built-in roles remain immutable; existing memberships and ownership/business constraints keep their historical behavior.
- The QC preset starts with view permissions; an administrator explicitly enables writes.
- Role deletion is blocked while any current or historical membership references it.
- Global user management and role definitions remain system-admin-only; project permissions apply within their project.
- Runtime workflow/member lookups are separate from full configuration/member details so hiding a section does not break permitted screens.
- Normalize prerequisites server-side; never trust client visibility or role rank for a custom role.
- Do not alter base components, remove user data, commit, or modify unrelated Report presentation.

## Verification
- API: 16 suites / 116 tests passed, including configurable role authorization, cross-project roles, live revocation, delegation limits, bulk action checks, cascade deletion, attachment parent access and deleted-project jobs.
- Web: 14 unit tests passed; production build passed. API build and API/web/shared ESLint passed.
- Browser: 5 scenarios passed (role editor and assignment, menu/tab/action/direct-link gates, role edits in current sessions, existing project tracking, quick search and layout).
- Independent backend/frontend review findings corrected and verified; no remaining blocker. Base components unchanged.
- Additive migration 0006 applied locally; existing memberships retain their built-in roles. API/worker restarted; API and web health both HTTP 200.
