# Module / Epic / Function / Backlog import

## Goal and approach

Extend the existing Excel preview → queued commit pattern, preserving base UI, existing testcase import and canonical project structure. Provide .xlsx templates, per-row diagnostics and all-or-nothing writes. Match structure by project-scoped code, Backlog updates by existing item key; never match identity by title. Epic is optional. Existing uncommitted structure work must remain intact.

## Workbook contract

Supported sheets: `Modules`, `Epics`, `Functions`, `Backlog`. A workbook can contain any applicable subset. Structure scope permits only the first three with data; Backlog scope permits all four and requires at least one Backlog row. Ignore only documented instruction sheets (`Hướng dẫn`/`Instructions`, optional `_Lists`). Reject formulas, unknown columns/sheets, duplicate headers, malformed files and >5,000 data rows / >10 MB uploads; avoid unbounded Excel expansion. Whitespace-only rows ignored. Values are JSON string/number; dates normalize to YYYY-MM-DD.

Canonical columns (templates display Vietnamese labels; parser supports clear English aliases):

- Modules: `code`, `name`, `description`.
- Epics: `code`, `name`, `moduleCodes`, `functionCodes` (explicit scope only).
- Functions: `code`, `name`, `moduleCode`, `epicCodes`, `traceRef`, `sources`.
- Backlog: `ref`, `itemKey`, `type`, `title`, `parent`, `epicCode`, `moduleCodes`, `functionCodes`, `period`, `assignee`, `priority`, `status`, `estimateMinutes`, `dueDate`, `description`.

Module/Epic/Function code+name headers required. Backlog title header required; title is required on create, blank means unchanged on update. Blank cells preserve existing values on updates; `[CLEAR]` explicitly clears optional relations/values. Codes are exact, case-sensitive project identifiers; comma/semicolon separates code lists, newline separates source paths. Backlog ref is an optional local workbook identity for resolving new parents; existing itemKey is the only update identity. New keys are allocated normally and shown in results. Duplicate ref/key/code rows error. Backlog type supports existing types and hierarchy (Epic → Story/Task/Bug → Subtask); Epic rows cannot have parent/Epic parent code. Existing type change is rejected. Metadata sheets allow creating prerequisite structure in the same transaction; cross-sheet order is independent. No automatic creation of users, statuses or periods; resolve active assignee email/current-mode open period name, reject ambiguous names and cross-project references. Module → Function without Epic works.

No deletion or automatic resurrection. Existing deleted identity errors instead of silently restoring it. Relationships are replaced only when a nonblank value or `[CLEAR]` is supplied; preserve metadata explicit-v-derived distinctions. Existing item versions and metadata snapshots must be validated again at commit. Status changes honor transition permission and workflow/bypass rules; validate required write permissions for all included nonempty sheets and non-default status changes.

## Shared parser/template interface

File `apps/api/src/project-import/import-workbook.ts` exports:

```
type ImportScope = 'structure' | 'backlog';
type ImportEntity = 'module' | 'epic' | 'function' | 'backlog';
type TemplateKind = ImportEntity | 'all';
interface ImportMessage { sheet: string; row?: number; column?: string; message: string }
interface ImportSourceRow { sheet: string; row: number; entity: ImportEntity; values: Record<string,string|number> }
interface ParsedProjectWorkbook { rows: ImportSourceRow[]; errors: ImportMessage[]; warnings: ImportMessage[] }
parseProjectWorkbook(buffer:Buffer, scope:ImportScope): Promise<ParsedProjectWorkbook>
buildProjectImportTemplate(kind:TemplateKind, context?:{projectKey?:string;statuses?:string[];periods?:string[]}):Promise<Buffer>
IMPORT_COLUMNS: Record<ImportEntity, readonly {key:string;label:string;aliases?:readonly string[];required?:boolean;note?:string}[]>
```

`all` template = three structure sheets; `backlog` template = all four. Templates have empty data sheets and examples/instructions separately so downloading/uploading a blank template never creates demo data. Header notes describe required/default/clear behavior; preserve numeric/date cell types. Backend validation uses the normalized canonical keys above.

## API/UI contract

New permissions: `project.structure.import` (group Dự án, requires structure.view + requirement.create/edit), `issue.import` (group Công việc, requires issue.view/create/edit). Builtin developer/tester defaults include them; admin retains full access; custom roles require explicit import grants. Backlog files with structure rows additionally require structure import; populated status changes require issue.transition and valid workflow transition, bypass only with workflow.bypass.

Under `/api/v1/projects/:key/imports`:

- GET `/template?kind=module|epic|function|all|backlog`: authenticated XLSX download; structure kinds require structure import, Backlog requires issue import.
- POST `/preview?scope=structure|backlog`: multipart field `file`; 202 `{jobId}`. Enqueue existing JobsService/QueueService pattern; no entity writes during preview.
- POST `/:sessionId/commit`: 202 `{jobId}`. Only owner/current authorized actor, same project, valid nonexpired preview, canCommit=true. Recheck permissions/entity/reference snapshots and atomically commit; block changed data with clear stale-preview error. Entire workbook rolls back on any failure. Retrying same commit is idempotent and returns prior result.
- GET `/api/v1/jobs/:jobId` existing polling returns `result` below and must enforce owner/current operation permissions for new import jobs, including after revocation/project deletion.

Preview job result:
```
{ sessionId,fileName,scope,canCommit,
  counts:{modules:{create,update},epics:{create,update},functions:{create,update},backlog:{create,update}},
  rows:[{sheet,row,entity,code,action:'create'|'update'|'error',summary:string,errors:string[]}],
  errors:ImportMessage[],warnings:ImportMessage[] }
```
Commit result: `{sessionId,counts,rows:[{sheet,row,entity,code,action,itemKey?:string}],completedAt}`.

Add a durable ProjectImportSession with project/owner/scope/parsed payload/preview state/expiry/result so the reviewed plan is immutable, commit/retry is atomic and idempotent. Use existing storage for uploaded file and existing jobs registry; preview expiry 24 hours. No schema changes to domain identities. New migration0009 creates import session storage only. Never trust client-supplied parsed rows or preview counts.

Frontend generic `ProjectImportButton` in `apps/web/src/features/project-import/**` accepts `{projectKey,scope:'structure'|'backlog',templateKind:'module'|'epic'|'function'|'all'|'backlog',canImport:boolean,label?:string}`. Show import button in each central structure tab (default template matches current tab; allow all-structure template), and Backlog toolbar. Modal uses AntD Upload/Steps/Alert/ListTable and existing waitForJob; download template, preview counts/row errors, disable commit on any error, show commit result/new item keys, retry another file. Preserve global base components and Report UI. On success invalidate metadata, requirements, backlog, board, issues, testcase summaries/grid reload as appropriate. Do not reset existing filters or navigate away. Localize count formatting.

## Work packages

- [x] Parser/templates agent owns only import-workbook.ts and its .spec.ts.
- [x] Backend agent owns all other apps/api/** and packages/shared/**: session migration, jobs, controllers/services, permission policy, transaction validation and integration tests. Reuse domain helpers/canonical triggers; no nested service transactions/partial imports.
- [x] UI agent owns apps/web/src/features/project-import/** plus import button wiring in ProjectStructurePage.tsx and BacklogPage.tsx. No API/schema changes or DB test runs.
- [x] Parent owns browser fixtures/tests, documentation/OpenAPI/client generation, integration review, final builds/suites and local migration/restart. Preserve previous task changes; no commits/pushes.

## Verification / review focus

Preview has zero writes; cross-sheet forward refs and cycles; optional Epic; blank vs clear; duplicate codes/ref/itemKey; correct canonical Epic and explicit module/function scope; workflow and active-period/assignee boundaries; unknown/cross-project refs; stale preview and partial rollback; repeated/concurrent commit; owner/project mismatch; permission revocation at enqueue/run/job read; formulas/row/file limits; >200 lookups; correct visible counters/errors/new-key results and cache refresh. Test migration against isolated DB before live deployment; snapshot/backup before applying0009.

## Verified result — 2026-11-03

- API: 22 suites / 174 tests passed, including 20 import integration regressions and 17 workbook parser tests.
- Web: 11 files / 38 tests passed. API and web builds passed; both linters passed. OpenAPI and generated client synchronized.
- Chrome browser: import preview/commit, invalid references, Module → Function without Epic, forward parent references, linked Epic/Task/Subtask and refreshed lists passed. Existing full project-structure browser regression passed.
- Independent parser/UI/backend review completed; findings fixed with regression coverage, including auth refresh, period mode, status resolution/triage, sheet-order conflicts, current permissions and shared Epic versions.
- Local PostgreSQL 18: backup `var/import-before-0009.dump`; migration0009 applied; full-row fingerprints confirmed all existing rows in 32 tables unchanged. API and worker restarted with final build; localhost:5173 responds. Real worker smoke test downloaded a template and rejected its empty preview without domain writes.
- Preserved base components and existing Report screens. No commits or pushes.
