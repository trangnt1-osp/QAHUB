# Bug contributors and recognition implementation plan

**Goal:** Place Bug after Test cases; report bugs by their reporter and recognize the project's leading manual bug reporters by calendar week/month.

**Architecture:** Extend the existing Bug breakdown with reporter counts under its existing filters. Add a project-authorized contributors endpoint with independent calendar filters and a recognition view inside Bug. Reuse existing avatars, tables, HTTP client and Ant Design controls; no dependencies or schema migration.

**Rules agreed with the user:** Count valid manual bugs only for recognition, excluding duplicates, rejected bugs, deleted bugs and automation. Count open and completed bugs by creation date. Use Vietnam time, Monday-start weeks, exclusive end boundaries, shared ranks on equal counts. Keep recognition independent of the report's open/assignee/source filters. No reporter means no personnel recognition. Historical users still retain attribution.

**Presentation:** Report and Vinh danh views within Bug. Recognition shows top contributors and a full ranked table with week/month and date selection, date range and counting rules. Empty/error/loading states are explicit. Reporter breakdown retains unowned/automation as a separate group rather than attributing them to staff.

## Tasks

- [x] Add failing API integration tests for reporter breakdown, valid-only rankings, ties, project isolation, permissions, and Vietnam calendar boundaries.
- [x] Implement calendar range helper and contributors API, explicit endpoint policy, and reporter breakdown SQL.
- [x] Add failing UI tests for recognition selection, report separation, and contributor display.
- [x] Add recognition component and reporter report widget; place Bug after Test cases.
- [x] Run API integration tests against a separate test database, web tests, type checks/builds, and browser checks. Restart local API with compiled changes.

## Verification

API: 7 integration/edge-case tests passed across contributors and the existing summary suite, using a newly created isolated test database. UI: 9 tests passed. Web TypeScript, Nest API build and Vite production build passed. Browser verified report placement, actual contributor results for week/month, and mobile rendering with the sidebar collapsed. Existing React test warnings and Vite chunk-size warnings remain.

Implementation rulings: pending-review bugs and manual records created by API keys do not earn personnel credit. The project's configured rejection status is excluded even when resolution is missing. Reporter drill-down adds a backend reporter filter and carries it through the Backlog URL; the report itself retains existing scope/source filters.

## Review focus

- Exact date boundaries and Sunday/month/year transitions; upper boundary must be exclusive.
- Duplicate/rejected/manual/API-created rows, deleted rows and missing reporters must not earn credit.
- Ties must not choose an arbitrary sole champion; all top-rank contributors are acknowledged.
- Ranking queries must remain project-scoped and permission checked.
- Ranking remains independent of report filters; loading or failed period changes must not show another period's winners.
