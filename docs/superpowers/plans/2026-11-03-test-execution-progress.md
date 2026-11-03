# Test execution progress

Goal: show execution coverage, (passed + failed) / total × 100, with total TC count kept separate. Not Started, Blocked and N/A remain in the total but are not executed results. Empty scopes show 0%; round percentages to one decimal and format vi-VN.

Use the existing shared API progressOf helper for function, epic and summary. Preserve Progress, Tree and grid base components; display the percentage and explain counts in a tooltip. Refresh tree/summary after drawer and inline-grid saves.

- [x] Add failing helper and integration coverage for mixed statuses, empty scopes, decimals and updating a result.
- [x] Update calculation and epic aggregation; display percentage alongside total TC with explanatory tooltip.
- [x] Refresh aggregate queries after inline and drawer saves, without reloading the grid.
- [x] Verify API suite, web unit tests/builds, lint and browser progress/update behavior. Update local API/worker.

Verification: 18 API suites / 126 tests and 17 web unit tests passed. Browser coverage passed for mixed-status progress, drawer and inline-grid changes, panel resizing, summary numeric formatting and localized numeric input. API build and scoped lint passed; web build passed. Independent read-only review reported no blockers. Excel exports now use the same execution percentage, including uncategorized cases. Local API/worker restarted; NDS-U-00796 verified as (88 + 29) / 250 = 46.8%.
