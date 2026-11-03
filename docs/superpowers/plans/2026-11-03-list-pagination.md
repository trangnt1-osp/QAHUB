# Numbered, paginated lists

User requests STT and pagination throughout list screens. Default10 rows, choices10/20/50/100. STT represents position in the current ordered/filtered list, continuing on later pages. Reset to first page when filters/project change; clamp after deletion. Board cards and activity timelines retain their layouts.

1. Root: tests-first shared ListTable with numbered first column, client pagination and optional cursor controls. Replace list Ant Tables: projects/users/project memberships/user project history/API keys/dashboard pending/labels. Report runs and results must use real cursor paging beyond old100/200 limits, reset on filters, stable latest20 chart.
2. Independent backlog task: per-group pages and STT while preserving DND, selections, headers and cursor-loading past cached rows.
3. Independent test-case task: AG Grid pagination/STT for both client and infinite models, reset on filters, retain selection/editing.
4. Root: number/page category list and workflow state/transition lists where appropriate. Run full frontend suite/build/lint and E2E for page2 numbering, size/filter resets, history and user editing regression. Review integration and confirm local.

Do not invent totals for cursor APIs: use previous/next, current page/range and size selector. No backend/schema/dependency changes required.
