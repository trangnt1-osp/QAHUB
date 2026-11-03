CREATE TABLE project_environments (
 id bigserial PRIMARY KEY,
 project_id bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
 kind text NOT NULL CHECK (kind IN ('dev','sit','uat','staging','production','other')),
 app_url text, api_url text, deployed_version text,
 owner_id bigint REFERENCES users(id) ON DELETE SET NULL,
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','maintenance','inactive')),
 notes text, version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
CREATE INDEX project_environments_project_id_idx ON project_environments(project_id);
CREATE UNIQUE INDEX project_environments_active_name_idx ON project_environments(project_id,lower(trim(name))) WHERE deleted_at IS NULL;
