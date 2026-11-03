CREATE TABLE project_import_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 owner_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 scope text NOT NULL CHECK (scope IN ('structure','backlog')),
 file_name text NOT NULL,
 payload jsonb NOT NULL,
 preview jsonb NOT NULL,
 snapshot text NOT NULL,
 expires_at timestamptz NOT NULL,
 result jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX project_import_sessions_project_owner_idx ON project_import_sessions(project_id,owner_id);
