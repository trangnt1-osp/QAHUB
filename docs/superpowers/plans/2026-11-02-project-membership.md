# Project information and membership history

User requests moving project membership out of Member tabs into project information, displaying member, role, join date and leave date. Autonomous implementation preference continues.

1. Add integration tests proving departure retains history but revokes project, auth/profile, dashboard and assignee access; rejoin preserves prior participation; date and last-admin rules remain enforced. Watch new tests fail before implementation.
2. Add ProjectMember id and nullable leftAt, keep joinedAt and existing rows. Replace compound primary key with id and a partial unique index on active project/user pairs, allowing multiple participation periods. Default list API remains active-only for existing assignee controls; status=all includes history. Add optional join date and a leave action/date. Existing DELETE records departure rather than deleting history. Serialize member changes using the project row lock and keep at least one active project admin.
3. Add project info tab with project fields and a membership table. All project viewers can read it; project/system admins add members, edit roles and record departure. Include active/left state and dates; departed entries are read-only. Remove membership tab/component from Member and limit Member menu to system admins.
4. Migrate local without deleting data; regenerate client and restart local processes after Windows Prisma generation. Run full backend suite, frontend build/tests/lint, and E2E for relocation, adding/leaving/rejoining, permissions and user-management regression. Independent review before completion.

Dates record actual participation: optional join date defaults to today; leave date defaults to today, cannot precede join date or be future. No access remains through retained historical records. Existing join timestamps are preserved. Old deleted memberships cannot be reconstructed.
