CREATE TABLE masterplan_milestones (
  id bigserial PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  start_date date,
  end_date date,
  owner_id bigint REFERENCES users(id) ON DELETE SET NULL,
  acceptance_criteria text,
  notes text,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_progress','completed','on_hold')),
  progress integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (start_date IS NULL OR end_date IS NULL OR start_date <= end_date)
);
CREATE INDEX masterplan_milestones_project_id_idx ON masterplan_milestones(project_id);
CREATE TABLE masterplan_features (
  milestone_id bigint NOT NULL REFERENCES masterplan_milestones(id) ON DELETE CASCADE,
  feature_id bigint NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  PRIMARY KEY (milestone_id, feature_id)
);
CREATE INDEX masterplan_features_feature_id_idx ON masterplan_features(feature_id);
