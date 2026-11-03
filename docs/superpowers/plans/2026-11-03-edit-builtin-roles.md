# Editable builtin project roles

> Implementation: execute inline, preserving the current workspace and base components.

**Goal:** A system administrator can edit permissions of Admin, Developer, Tester and Viewer in the existing Roles drawer.

**Architecture:** Store permission overrides in the existing role_definitions table under reserved builtin keys. Keep builtin assignment identifiers (role, roleId=null) compatible. Resolve overrides for existing memberships on every API request, auth/me, project lists, dashboards and delegation checks; fall back to shared defaults when no override exists. System administrators retain full access independently of project-role overrides. Builtin names/keys and deletion remain protected.

**Constraints:** Reuse ListTable, ActionIconButton, Drawer and existing permission normalization. Do not modify Report UI or base components. Migration 0007 permits reserved builtin keys in role_definitions; the API continues to protect those identities. No reassignment or restart of sessions is required for changes to take effect.

## Tasks

- [x] Add integration tests for editing all builtin roles, existing-token revocation, auth/me and listing consistency, delegation, protected identifiers and system administrator access; run and confirm expected failures.
- [x] Implement reserved builtin updates and shared runtime resolution, including explicit permission checks replacing project-admin bypasses where needed.
- [x] Make existing Roles drawer editable for builtin permissions; preserve fixed identity, no delete; add browser coverage for save/cancel and project menus.
- [x] Run API suite, web unit tests, type checks, scoped lint, builds and relevant browser scenarios; review the final changes.

## Verification

- API suite: 17 suites, 123 tests passed. Added seven builtin-role integration cases, including missing/null grants and ownership/workflow bypass revocation.
- Web unit tests: 17 passed. API and web builds and scoped ESLint passed.
- Browser: builtin-role save/cancel/menu changes, custom role permissions and user/project role synchronization passed. Tests allow Ant Design's loading icon in the Save button's accessible name.
- Independent read-only review found no blockers. Migration 0007 applied locally; API and worker restarted; localhost:5173 and API role listing verified.

## Review focus

- Empty permission overrides must not fall back to defaults.
- Existing members and tokens must see edited permissions without reassigning roles.
- Custom role definitions and builtin overrides must not appear twice or cross assignment namespaces.
- Project Admin permissions must be configurable while system administrators retain role management.
- Member delegation and ownership/workflow checks must use effective permissions.
