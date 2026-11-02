ALTER TABLE project_members
  ADD COLUMN id BIGSERIAL,
  ADD COLUMN left_at TIMESTAMPTZ(6),
  DROP CONSTRAINT project_members_pkey,
  ADD PRIMARY KEY (id),
  ADD CONSTRAINT project_members_date_range_check CHECK (
    (left_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >= (joined_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
  );

CREATE UNIQUE INDEX project_members_active_unique ON project_members (project_id, user_id) WHERE left_at IS NULL;
CREATE INDEX project_members_project_id_user_id_idx ON project_members (project_id, user_id);
CREATE INDEX project_members_project_id_left_at_idx ON project_members (project_id, left_at);
