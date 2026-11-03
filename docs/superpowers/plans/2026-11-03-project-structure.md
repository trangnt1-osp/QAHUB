# Project structure and traceability

## Intent and constraints

Implement the user's requested relations: project Module → Function → Test case; shared Epic → Story/Task/Bug → Subtask; Item → Functions/Modules; Sprint/Phase scheduling unchanged. Add a project Epic / Module management tab and shared selectors/filters. Preserve existing codes, item keys, history, testcase data and base components; do not alter Report UI. Existing Epic sources must be linked, without merging records solely by matching names.

## Architecture and choices

- Canonical work Epic remains an Issue(type=epic), retaining workflow/status/item key. Its business metadata is a 1:1 Requirement(kind=epic) linked by `epicIssueId`. Requirement.code retains NDS-style business codes and RequirementLink retains explicit legacy Epic/Function scope. All create/update/delete paths maintain the pair transactionally, including Excel import and seeds. Migration backfills both old sources with distinct canonical identities, preserving all references.
- New ProjectModule has id/projectId/code/name/description/deletedAt. A Function Requirement has optional moduleId (one module per Function, legacy unassigned allowed).
- IssueModule and IssueFunction joins permit many related modules/functions per item. Function assignment includes its module among item modules. Enforce active same-project references; reject links to epic requirements as Functions.
- Epic scope may contain multiple Modules. Epic → Functions/Test cases includes explicit legacy RequirementLinks and functions referenced by its work items, including subtasks; no automatic destructive conversion of legacy scope.
- Backlog is a view. Filter by Epic (canonical Issue id), Module, Function and Sprint/Phase; preserve existing URL/query/filter behavior. Testcase filtering accepts Module as well as existing Function/Epic requirement IDs. Keep old testcase Epic IDs stable; expose canonical issue mapping explicitly so UI never mixes namespaces.
- Add permission `project.structure.view` (group Dự án). Existing requirement.create/edit/delete govern structure writes and require structure view; keep testcase runtime access separate. Basic `/structure/options` metadata supports permitted issue/testcase users without exposing protected issue/testcase counts or member/settings information. Existing permission normalization and UI editor automatically include the new project-prefixed grant.
- Block deleting linked Modules and Epics, preserve existing Function/TC deletion rules but reject deletion if work-item references would dangle. System admins retain full access.

## API contract for frontend work

All paths are under /api/v1; numeric JSON IDs, vi-VN formatting presentation only.

GET `/projects/:key/structure` (project.structure.view), GET `/projects/:key/structure/options` (OR issue.view/testcase.view/project.structure.view) return:

```
{ modules: [{id,code,name,description}],
  functions: [{id,code,name,moduleId,epicIds:number[]}],
  epics: [{id /*Issue id*/,requirementId,key /*Issue key*/,code /*business code*/,name,moduleIds:number[],functionIds:number[],version}] }
```

Metadata only; optional extra fields are additive. `epicIds` on Function refer to legacy Requirement IDs. All three arrays are complete (not truncated to first page).

- Module POST `/projects/:key/modules` {code,name,description?}; PATCH/DELETE `/projects/:key/modules/:id`.
- Function and Epic writes use existing POST `/projects/:key/requirements`, PATCH/DELETE `/requirements/:id`. Extend create/update with `moduleId?: number|null` for Function, `moduleIds?:number[]` for Epic; retain existing `epicIds`/`functionIds` business links. Creation of an Epic via requirements creates its canonical Issue too. Central UI supplies business code and name.
- Issue create/update accept `moduleIds?:number[]`, `functionIds?:number[]`, existing `parentKey` for Epic. Return `modules:[{id,code,name}], functions:[{id,code,name,moduleId}], moduleIds, functionIds` in list/detail DTOs. Empty arrays unlink. Optional null parentKey clears parent.
- Issues/backlog/board queries accept `moduleId?:string`, `functionId?:string`, existing `epicId?:string` (Issue id) and `sprintId`/period handling.
- Requirements tree retains existing `epics`, `unassigned` response; adds modules and function moduleId/module metadata, and epic epicIssueId/issueKey/moduleIds. Testcase list/ids/summary/export accept `moduleId?:string`; existing `epicId` remains Requirement id. Epic coverage includes linked work item Functions.

## Work packages and ownership

- [x] Backend/domain: schema migration, shared permission, CRUD/metadata/options, canonical Epic sync and legacy migration, item relations/filtering, testcase/Excel integration, integration tests. Own apps/api/** and packages/shared/**.
- [x] Central frontend: new project-structure API/types/hooks in apps/web/src/features/project-structure/**, management tab/page CRUD using existing ListTable/ActionIconButton/Form/Modal, project tab/navigation permissions. Own that folder, app/ProjectLayout.tsx and lib/permissions.ts only.
- [x] Parent integration: issue create/detail assignment, Backlog filters/quick create, testcase Module filters/tree/quick create, API client generation/types as needed, browser integration tests. Parent owns remaining web files.
- [x] Review each work package and whole change; run API/web suites, builds/lint, migration against isolated test databases, browser end-to-end traceability and permission checks, verify preservation on local migration then restart local services.

## Review focus

Cross-project/soft-deleted references; namespace confusion between Epic Issue IDs and Requirement IDs; module/function links inherited through subtasks; create/import/seed/update/delete paths bypassing Epic synchronization; custom-role permission leaks; duplicated/missing data from legacy migration; query pagination beyond 200 options; stale caches after cross-screen changes; no automatic name-based merges.

Ruling: use a 1:1 compatibility bridge instead of deleting/replacing either old Epic table. This preserves testcase IDs/codes and work-item workflows while exposing one Epic identity to the application.
Ruling: do not automatically assign legacy Functions to Modules based on Epic names. Leave them unassigned until explicitly classified, because an Epic may span multiple Modules.

Ruling: IssueModule stores explicit links only. DTOs and filters derive Function Modules dynamically, so removing/moving a Function cannot leave an accidental Module association. Canonical Epic explicit scope lives in EpicModule/RequirementLink and is shared by Issue and Requirement entrypoints; the metadata API distinguishes explicit form values from aggregate display scope.

Ruling: only Subtasks inherit parent work-item classification for filtering. An Epic's broad scope does not assign all of its Functions to every Story/Task/Bug automatically.

## Review and deployment evidence

Independent reviews covered the API migration and central/parent UI. Findings were fixed with regressions: relation-only Issue versions/history, canonical Epic scope/version synchronization, long business names during unrelated Issue updates, active endpoint scope, explicit versus inferred Module links, combined export filters, Module restoration before Function import, and editor hydration after mount.

Local migration 0008 deployed after a pg_dump backup. Hash comparison verified every existing row in 28 public data tables remains present and unchanged (excluding newly added Requirement columns and the intentionally advanced project issue counter), and every Epic has its canonical counterpart. API and worker restarted; localhost:5173 and ELMS structure metadata verified. Existing ELMS has 20 Functions; none were silently assigned to invented Modules.

Browser evidence: full structure flow passes creation of Module/Function/Epic, canonical Issue scope, item assignment, Epic/Module/Function/Sprint filters, testcase scope, name-only edit without scope materialization, unlinking Function and its derived Module, and quick Epic creation from both Test cases and Backlog. Existing period tracking, quick search, custom role access, testcase progress and resizing regression scenarios passed.

Final verification: 20 API suites / 137 tests passed on final implementation; 9 web files / 28 tests passed, including actual mounted-form prefill/cancel/name-only-save regression. Shared/API/web builds and scoped lint passed. Whole-feature read-only review found no remaining blockers. Local API/worker are running with migration0008; initial backup and preservation evidence remain in ignored var/ task artifacts. No commits/pushes or Report/base component edits.
