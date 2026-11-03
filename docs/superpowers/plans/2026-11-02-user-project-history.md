# View user project history

Add a View action to Member > Users. A read-only drawer displays current user information and all project participation periods: project key/name, role, joined date, left date and status. Preserve repeated participation and deleted project history, with no link to deleted projects. Access follows existing user management: system admins only. Use existing membership data; no schema migration.

1. Write API tests for all periods, safe user fields, deleted projects, empty history, missing user, non-admin denial. Verify failure before adding endpoint.
2. Add GET /users/:id (getUserDetail) guarded by SystemRole admin. Explicitly select public user fields and memberships with minimal project fields, newest first.
3. Add UserDetailDrawer and View button; load by selected id with fresh query on each open. Handle loading, empty and error states. Use membership id as row key and existing date rendering.
4. Build backend without regenerating Prisma, update OpenAPI/client, test API/frontend and user history E2E, lint/review, restart only local API/worker processes using built entrypoints. Leave existing membership/history behavior intact.
