ALTER TABLE projects ADD COLUMN tracking_mode TEXT NOT NULL DEFAULT 'sprint';
ALTER TABLE projects ADD CONSTRAINT project_tracking_mode CHECK (tracking_mode IN ('sprint', 'phase'));
ALTER TABLE sprints ADD COLUMN kind TEXT NOT NULL DEFAULT 'sprint';
ALTER TABLE sprints ADD CONSTRAINT period_kind CHECK (kind IN ('sprint', 'phase'));
DROP INDEX one_active_sprint;
CREATE UNIQUE INDEX one_active_sprint ON sprints(project_id) WHERE state = 'active' AND deleted_at IS NULL AND kind = 'sprint';
CREATE INDEX periods_project_kind ON sprints(project_id, kind, state) WHERE deleted_at IS NULL;
