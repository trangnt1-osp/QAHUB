# Compact role permission editor

Goal: simplify the long permission form while preserving all existing grants and dependency semantics.

Use the existing Ant Design Drawer/Form/Collapse/Checkbox/Input/Tooltip components. Put role name/code side by side responsively, then show six collapsed permission areas with selected/total counts. Search labels, groups and permission keys with Vietnamese accent-insensitive matching, automatically opening matching areas. Keep an expand/collapse-all link. Show a short live announcement when a toggle enables prerequisites or removes dependents; details belong in a tooltip. Preserve Save/Cancel behavior, API payloads, system-admin protection and builtin identity fields. No base component or Report page changes.

- [x] Write failing component tests for initial compact state, search, dependent toggles and disabled state.
- [x] Implement controlled PermissionEditor and integrate it into the existing Roles drawer.
- [x] Update affected browser tests for collapsed groups; verify search/dependencies, desktop/mobile layout, custom/builtin saves and cancel.
- [x] Run web unit suite, typecheck/build, lint and read-only review.

Validation: 22 web unit tests passed, including full catalog coverage (51 grants), accent-insensitive search and cross-area dependency removal. Web build/typecheck and scoped ESLint passed. Browser tests for builtin edits/save/cancel, custom role grants and the responsive permission editor passed. Screenshots inspected at 1600px and 390px. Read-only review found no blockers. Local Vite serves the new component; no backend or base component changes.
