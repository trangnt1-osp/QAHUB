# Consistent member view and edit

User requested the same UI/UX for viewing and editing a member. Existing autonomous implementation preference applies.

Use one UserDetailDrawer with initialMode=view/edit from the list actions. Share the same title, width, form fields, field order and project history table. View has read-only text fields and disabled role/status controls; edit enables permitted fields, keeping self-access protection. View footer: Close/Edit; edit footer: Cancel/Save. Cancel and successful save close the drawer consistently. Show loading/errors in the shared shell, retain validation and inputs on save errors, and block closing/navigation through project links during save. Refetch fresh details on open and refresh user/member/profile/detail caches after save.

1. Add E2E proving view/edit share fields and history, switch mode in place, and cancel discards edits. Observe failure against existing separate modal/drawer.
2. Merge EditUserModal logic into UserDetailDrawer; use one selected-user/mode state in MembersPage and remove the obsolete modal. Preserve existing validation, saving/error behavior and fresh detail data.
3. Update existing edit/history E2E to use the shared drawer and read-only form. Run member/history E2E, frontend build/tests/lint and independent review; confirm local app works. No backend or schema changes.
