# Edit projects and project dates

User requested the same edit interaction as users, plus project start/end dates. Autonomous implementation preference persists. Work in current checkout to update local app.

Approach: add an edit modal to ProjectsPage, using existing PATCH /projects/:projectKey permissions. Edit name, description, lead, startDate and endDate; keep project key fixed. Share optional date fields between create/edit/general settings. Store nullable PostgreSQL DATE values, exchange YYYY-MM-DD inputs, display DD/MM/YYYY, require endDate >= startDate when both exist. Preserve dates omitted in PATCH and allow null to clear either date. Existing projects receive null dates.

1. Add API tests for create/list/get dates, persisted edits, partial updates, clearing dates, invalid/reversed dates, missing leads and role restrictions. Run and confirm date behavior fails first.
2. Add migration and Prisma fields. Validate date-only inputs and merged date ranges in service; validate lead references before updating. Regenerate Prisma client after stopping only this session's API/worker processes to release Windows DLL locks; migrate local and dedicated test databases.
3. Add edit modal with prefilled values, immutable key, validation, saving/error state, cancel behavior and cache/profile refresh. Stop row navigation for edit clicks. Add date columns and fields to creation and GeneralSettings.
4. Regenerate OpenAPI/client; run API/web/shared tests, builds, targeted lint and project E2E on a dedicated database. Review changes and confirm local services run.

Review focus: partial updates must compare against stored counterpart date; equal dates valid; null clears persisted dates; invalid leap dates rejected; viewer/developer cannot edit; edit button does not navigate; new schema must not delete existing local data.
